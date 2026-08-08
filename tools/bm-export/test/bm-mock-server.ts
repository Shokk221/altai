import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * BM API'sini taklit eden yerel sunucu. Gerçek BM'ye karşı test edemiyoruz
 * (token yok, hız limiti gerçek, veri geri alınamaz) — ama arşivleyicinin
 * gerçekten kırılgan olduğu yerler (sayfalama, resume, 429, 403, oyuncu başına
 * fan-out) BM'ye özgü değil, JSON:API davranışına özgü. Onları burada
 * uçtan uca doğruluyoruz.
 */

export interface MockOptions {
  /** Kaç oyuncu üretilsin (2'şerli sayfalara bölünür). */
  playerCount?: number;
  /** Bu yol için ilk N istek 429 dönsün. */
  rateLimitOnce?: string;
  /** Bu yolları 403 ile reddet. */
  forbidden?: string[];
  /** N'inci istekten sonra bağlantıyı kes (resume testi için). */
  failAfterRequests?: number;
}

export interface MockServer {
  url: string;
  requests: string[];
  countFor(pathPrefix: string): number;
  close(): Promise<void>;
}

function player(id: number) {
  return {
    type: 'player',
    id: String(id),
    attributes: { name: `Oyuncu${id}`, createdAt: '2021-01-01T00:00:00.000Z' },
    relationships: { identifiers: { data: [{ type: 'identifier', id: `id-${id}` }] } },
  };
}

export async function startMockBm(options: MockOptions = {}): Promise<MockServer> {
  const playerCount = options.playerCount ?? 6;
  const forbidden = options.forbidden ?? [];
  const requests: string[] = [];
  const rateLimited = new Set<string>();

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    requests.push(pathname + url.search);

    if (options.failAfterRequests && requests.length > options.failAfterRequests) {
      // Soketi cevap vermeden kopar — çekimin ortasında ağ kesintisi.
      res.socket?.destroy();
      return;
    }

    if (forbidden.some((f) => pathname.includes(f))) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ status: '403', title: 'Forbidden' }] }));
      return;
    }

    // Aynı yol için sadece ilk istekte 429 — Retry-After'a uyulup uyulmadığını test eder.
    if (options.rateLimitOnce && pathname.includes(options.rateLimitOnce)) {
      if (!rateLimited.has(pathname)) {
        rateLimited.add(pathname);
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
        res.end(JSON.stringify({ errors: [{ status: '429' }] }));
        return;
      }
    }

    const json = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    // --- /servers/{id} ---
    const serverMatch = /^\/servers\/(\w+)$/.exec(pathname);
    if (serverMatch) {
      json({
        data: {
          type: 'server',
          id: serverMatch[1],
          attributes: { name: `Altai #${serverMatch[1]}` },
        },
      });
      return;
    }

    // --- /player-flags (flag tanımları) ---
    if (pathname === '/player-flags') {
      json({
        data: [
          { type: 'playerFlag', id: 'flag-a', attributes: { name: 'SL ban' } },
          { type: 'playerFlag', id: 'flag-b', attributes: { name: 'HİLE ŞÜPHELİSİ' } },
        ],
      });
      return;
    }

    // --- /players?filter[playerFlags]= (flag başına tarama) ---
    const flagFilter = url.searchParams.get('filter[playerFlags]');
    if (pathname === '/players' && flagFilter) {
      // flag-a'da 2 oyuncu, flag-b'de 1 oyuncu — biri ikisinde birden.
      const ids = flagFilter === 'flag-a' ? [1, 2] : [2];
      json({
        data: ids.map(player),
        included: [
          { type: 'playerFlag', id: flagFilter, attributes: { name: flagFilter } },
          ...ids.map((i) => ({
            type: 'flagPlayer',
            id: `${i}:${flagFilter}`,
            attributes: { addedAt: '2025-06-15T18:35:55.738Z', removedAt: null },
            relationships: {
              player: { data: { type: 'player', id: String(i) } },
              playerFlag: { data: { type: 'playerFlag', id: flagFilter } },
            },
          })),
        ],
      });
      return;
    }

    // --- /bans (aday kümesi testi için oyuncu ilişkisi taşır) ---
    if (pathname === '/bans') {
      json({
        data: [
          {
            type: 'ban',
            id: 'ban-1',
            attributes: { reason: 'test' },
            relationships: { player: { data: { type: 'player', id: '4' } } },
          },
        ],
      });
      return;
    }

    // --- /players (sayfalı, included ile) ---
    if (pathname === '/players') {
      const pageSize = Number(url.searchParams.get('page[size]') ?? '2');
      const key = Number(url.searchParams.get('page[key]') ?? '0');
      const slice = Array.from({ length: playerCount }, (_, i) => i + 1).slice(key, key + pageSize);
      const nextKey = key + pageSize;
      const body: Record<string, unknown> = {
        data: slice.map(player),
        // Her sayfada aynı server included olarak döner — tekilleştirme testi.
        included: [
          { type: 'server', id: '111', attributes: { name: 'Altai #111' } },
          ...slice.map((i) => ({
            type: 'identifier',
            id: `id-${i}`,
            attributes: { type: 'steamID', identifier: `7656119${i}` },
          })),
        ],
      };
      if (nextKey < playerCount) {
        body.links = { next: `${baseUrl()}/players?page[size]=${pageSize}&page[key]=${nextKey}` };
      }
      json(body);
      return;
    }

    // --- /players/{id}/relationships/notes ---
    const notesMatch = /^\/players\/(\w+)\/relationships\/notes$/.exec(pathname);
    if (notesMatch) {
      json({
        data: [
          {
            type: 'playerNote',
            id: `note-${notesMatch[1]}`,
            attributes: { note: `Not ${notesMatch[1]}` },
          },
        ],
      });
      return;
    }

    // --- /players/{id}/relationships/flags ---
    const flagsMatch = /^\/players\/(\w+)\/relationships\/flags$/.exec(pathname);
    if (flagsMatch) {
      json({
        data: [{ type: 'flagPlayer', id: `fp-${flagsMatch[1]}` }],
        included: [{ type: 'playerFlag', id: 'flag-1', attributes: { name: 'SL BAN' } }],
      });
      return;
    }

    // --- zaman aralıklı geçmiş uçları ---
    if (pathname.endsWith('/player-count-history')) {
      json({ data: [{ type: 'dataPoint', attributes: { value: 42 } }] });
      return;
    }

    // --- diğer düz liste uçları ---
    json({ data: [{ type: pathname.slice(1), id: '1', attributes: {} }] });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = () => `http://127.0.0.1:${port}`;

  return {
    url: baseUrl(),
    requests,
    countFor: (prefix) => requests.filter((r) => r.startsWith(prefix)).length,
    close: () =>
      new Promise<void>((resolve) => {
        // Keep-alive bağlantıları da kapatılmalı, yoksa close() askıda kalır.
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
