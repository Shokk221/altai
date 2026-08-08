import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Archive } from '../src/archive.js';
import { BmClient } from '../src/bm-client.js';
import { exportList, readResourceIds, resolveServers } from '../src/export-list.js';
import { exportFlagAssignments, readNoteCandidates } from '../src/flag-assignments.js';
import { exportPerPlayer } from '../src/per-player.js';
import { PER_PLAYER_RESOURCES } from '../src/resources.js';
import { type MockServer, startMockBm } from './bm-mock-server.js';

const ORG_ID = '9999';

async function readNdjson(filePath: string): Promise<Array<Record<string, unknown>>> {
  if (!existsSync(filePath)) return [];
  const content = await readFile(filePath, 'utf8');
  return content
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('bm-export', () => {
  let dir: string;
  let mock: MockServer;

  const makeClient = () =>
    // Testte hız limitini kapat (rps yüksek) — gerçek gecikme davranışı
    // ayrı bir testte (429) doğrulanıyor.
    new BmClient({ token: 't', baseUrl: mock.url, requestsPerSecond: 1000, maxRetries: 3 });

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'bm-archive-'));
  });

  afterEach(async () => {
    await mock?.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('links.next zincirini sonuna kadar takip eder ve included kayıtlarını tekilleştirir', async () => {
    mock = await startMockBm({ playerCount: 6 });
    const archive = await Archive.open(dir, ORG_ID);

    const total = await exportList({
      name: 'players',
      path: '/players',
      params: { 'page[size]': '2' },
      client: makeClient(),
      archive,
      critical: true,
    });
    await archive.close();

    expect(total).toBe(6);
    const players = await readNdjson(archive.dataPath('players'));
    expect(players).toHaveLength(6);
    expect(players.map((p) => p.id)).toEqual(['1', '2', '3', '4', '5', '6']);

    // 3 sayfanın hepsinde aynı server included olarak döndü — bir kez yazılmalı.
    const included = await readNdjson(archive.includedPath('players'));
    const servers = included.filter((i) => i.type === 'server');
    expect(servers).toHaveLength(1);
    expect(included.filter((i) => i.type === 'identifier')).toHaveLength(6);

    expect(archive.state.resources.players?.status).toBe('done');
  });

  it('yarıda kesilen çekim, ikinci çalıştırmada kaldığı yerden devam eder', async () => {
    // İlk 2 istekten sonra bağlantıyı kes: 2 sayfa (4 oyuncu) yazılmış olur.
    mock = await startMockBm({ playerCount: 8, failAfterRequests: 2 });
    const archive = await Archive.open(dir, ORG_ID);

    await expect(
      exportList({
        name: 'players',
        path: '/players',
        params: { 'page[size]': '2' },
        // maxRetries: 0 — ağ hatasında üstel geri çekilmeyi beklemeden hemen
        // fırlatsın. Geri çekilme davranışı 429 testinde ayrıca doğrulanıyor.
        client: new BmClient({
          token: 't',
          baseUrl: mock.url,
          requestsPerSecond: 1000,
          maxRetries: 0,
        }),
        archive,
        critical: true,
      }),
    ).rejects.toThrow();
    await archive.close();

    const partial = await readNdjson(path.join(dir, 'players.ndjson'));
    expect(partial.length).toBe(4);
    expect(partial.length).toBeLessThan(8);

    const state = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    expect(state.resources.players.status).toBe('failed');
    expect(state.resources.players.cursor).toContain('page[key]');

    // Sağlam sunucu, aynı dizin: kalan sayfalar eklenmeli, baştan çekilmemeli.
    await mock.close();
    mock = await startMockBm({ playerCount: 8 });
    const resumed = await Archive.open(dir, ORG_ID);
    await exportList({
      name: 'players',
      path: '/players',
      params: { 'page[size]': '2' },
      client: makeClient(),
      archive: resumed,
      critical: true,
    });
    await resumed.close();

    const all = await readNdjson(path.join(dir, 'players.ndjson'));
    expect(all.map((p) => p.id)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(resumed.state.resources.players?.status).toBe('done');
  });

  it('429 Retry-After alınca bekler ve isteği yeniden dener', async () => {
    mock = await startMockBm({ rateLimitOnce: '/bans' });
    const archive = await Archive.open(dir, ORG_ID);

    const total = await exportList({
      name: 'bans',
      path: '/bans',
      params: {},
      client: new BmClient({
        token: 't',
        baseUrl: mock.url,
        requestsPerSecond: 1000,
        maxRetries: 3,
      }),
      archive,
      critical: true,
    });
    await archive.close();

    expect(total).toBe(1);
    // İlk istek 429, ikincisi başarılı.
    expect(mock.countFor('/bans')).toBe(2);
    expect(archive.state.resources.bans?.status).toBe('done');
  });

  it('403 dönen uç arşivi durdurmaz, "unsupported" işaretlenir', async () => {
    mock = await startMockBm({ forbidden: ['/reserved-slots'] });
    const archive = await Archive.open(dir, ORG_ID);

    const total = await exportList({
      name: 'reserved-slots',
      path: '/reserved-slots',
      params: {},
      client: makeClient(),
      archive,
      critical: true,
    });
    await archive.close();

    expect(total).toBe(0);
    expect(archive.state.resources['reserved-slots']?.status).toBe('unsupported');
    // 403 yeniden denenmemeli — limit yakmanın anlamı yok.
    expect(mock.countFor('/reserved-slots')).toBe(1);
  });

  it("sunucu ID'leri açıkça verildiğinde keşif isteği atılmaz, meta arşivlenir", async () => {
    mock = await startMockBm();
    const archive = await Archive.open(dir, ORG_ID);

    const ids = await resolveServers(makeClient(), archive, ['111', '222']);
    await archive.close();

    expect(ids).toEqual(['111', '222']);
    expect(archive.state.serverIds).toEqual(['111', '222']);
    // /servers listeleme ucu hiç çağrılmamalı.
    expect(mock.requests.filter((r) => r.startsWith('/servers?'))).toHaveLength(0);
    const servers = await readNdjson(archive.dataPath('servers'));
    expect(servers.map((s) => s.attributes)).toEqual([
      { name: 'Altai #111' },
      { name: 'Altai #222' },
    ]);
  });

  it('oyuncu başına notları çeker, _playerId damgalar ve tamamlananları atlar', async () => {
    mock = await startMockBm({ playerCount: 4 });
    const archive = await Archive.open(dir, ORG_ID);
    await exportList({
      name: 'players',
      path: '/players',
      params: { 'page[size]': '2' },
      client: makeClient(),
      archive,
      critical: true,
    });

    const notes = PER_PLAYER_RESOURCES.find((r) => r.name === 'player-notes');
    if (!notes) throw new Error('player-notes tanımı yok');

    await exportPerPlayer({ client: makeClient(), archive, resource: notes, concurrency: 3 });
    await archive.close();

    const written = await readNdjson(archive.dataPath('player-notes'));
    expect(written).toHaveLength(4);
    // Her satır hangi oyuncuya ait olduğunu tek başına taşımalı (ETL bunu kullanır).
    expect(new Set(written.map((n) => n._playerId))).toEqual(new Set(['1', '2', '3', '4']));

    const done = (await readFile(path.join(dir, 'player-notes.done'), 'utf8'))
      .split('\n')
      .filter(Boolean);
    expect(done.sort()).toEqual(['1', '2', '3', '4']);

    // İkinci çalıştırma: hepsi "done", tek bir ek istek atılmamalı.
    const before = mock.countFor('/players/');
    const reopened = await Archive.open(dir, ORG_ID);
    await exportPerPlayer({
      client: makeClient(),
      archive: reopened,
      resource: notes,
      concurrency: 3,
    });
    await reopened.close();
    expect(mock.countFor('/players/')).toBe(before);
  });

  it('oyuncu başına uç 403 dönerse faz atlanır, süreç çökmez', async () => {
    mock = await startMockBm({ playerCount: 4, forbidden: ['/relationships/notes'] });
    const archive = await Archive.open(dir, ORG_ID);
    await exportList({
      name: 'players',
      path: '/players',
      params: { 'page[size]': '2' },
      client: makeClient(),
      archive,
      critical: true,
    });

    const notes = PER_PLAYER_RESOURCES.find((r) => r.name === 'player-notes');
    if (!notes) throw new Error('player-notes tanımı yok');

    await expect(
      exportPerPlayer({ client: makeClient(), archive, resource: notes, concurrency: 2 }),
    ).resolves.toBe(0);
    await archive.close();

    expect(archive.state.resources['player-notes']?.status).toBe('unsupported');
  });

  it('flag atamalarını oyuncu başına değil, flag başına tarayarak çeker', async () => {
    mock = await startMockBm({ playerCount: 4 });
    const archive = await Archive.open(dir, ORG_ID);
    const ctx = { organizationId: ORG_ID, serverIds: ['111'] };

    await exportList({
      name: 'player-flags',
      path: '/player-flags',
      params: {},
      client: makeClient(),
      archive,
      critical: true,
    });

    const total = await exportFlagAssignments({ client: makeClient(), archive, ctx });
    await archive.close();

    // flag-a: 2 atama, flag-b: 1 atama.
    expect(total).toBe(3);
    const rows = await readNdjson(archive.dataPath('player-flag-assignments'));
    expect(rows.every((r) => r.type === 'flagPlayer')).toBe(true);
    // Atama meta verisi (kim/ne zaman) korunmalı — per-player yolundan farkı yok.
    expect(rows[0]?.attributes).toMatchObject({ addedAt: '2025-06-15T18:35:55.738Z' });

    // Oyuncu başına HİÇ istek atılmamalı; sadece flag başına tarama.
    expect(mock.requests.filter((r) => /^\/players\/\d+\//.test(r))).toHaveLength(0);
    expect(mock.requests.filter((r) => r.includes('filter%5BplayerFlags%5D'))).toHaveLength(2);
  });

  it("not adayları = flag'i olan ∪ banı olan oyuncular", async () => {
    mock = await startMockBm({ playerCount: 4 });
    const archive = await Archive.open(dir, ORG_ID);
    const ctx = { organizationId: ORG_ID, serverIds: ['111'] };

    for (const [name, path] of [
      ['player-flags', '/player-flags'],
      ['bans', '/bans'],
    ] as const) {
      await exportList({ name, path, params: {}, client: makeClient(), archive, critical: true });
    }
    await exportFlagAssignments({ client: makeClient(), archive, ctx });

    const candidates = await readNoteCandidates(archive);
    await archive.close();

    // flag'li oyuncular 1 ve 2 (2 iki flag'te birden — tekilleşmeli), banlı oyuncu 4.
    expect(candidates.sort()).toEqual(['1', '2', '4']);
  });

  it('manifest başka bir organizasyonun arşivine yazmayı reddeder', async () => {
    mock = await startMockBm();
    const archive = await Archive.open(dir, ORG_ID);
    await archive.close();

    await expect(Archive.open(dir, '1234')).rejects.toThrow(/başka bir organizasyonun arşivi/);
  });

  it('readResourceIds tekrarlı ve bozuk satırları eler', async () => {
    mock = await startMockBm({ playerCount: 4 });
    const archive = await Archive.open(dir, ORG_ID);
    await exportList({
      name: 'players',
      path: '/players',
      params: { 'page[size]': '2' },
      client: makeClient(),
      archive,
      critical: true,
    });
    await archive.close();

    const ids = await readResourceIds(archive.dataPath('players'));
    expect(ids).toEqual(['1', '2', '3', '4']);
  });
});
