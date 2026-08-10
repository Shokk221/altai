import type { AgentEvent } from '@altai/contracts';
import { AgentEvent as AgentEventSchema } from '@altai/contracts';
import { describe, expect, it } from 'vitest';
import { createSquadJSAdapter } from '../src/adapter.js';
import type { SquadJSEngine, SquadJSEngineEvents } from '../src/engine.js';

/**
 * Yetkili işlemlerinin RCON sohbet kanalından olaya dönüşü.
 *
 * Ham veri cimri ve tutarsız: uyarıda metin `reason`, duyuruda `message`
 * alanında geliyor; uyarıda kimlik hiç yok. Dönüşüm bozulursa akışta
 * "(bilinmiyor) uyarıldı" satırları çıkar — hata vermez, sadece işe
 * yaramaz olur.
 */

function kurulum() {
  const dinleyiciler = new Map<string, ((raw: never) => void)[]>();
  const olaylar: AgentEvent[] = [];

  const engine = {
    serverSlug: 'squad-01',
    on<K extends keyof SquadJSEngineEvents>(event: K, listener: SquadJSEngineEvents[K]) {
      const liste = dinleyiciler.get(event) ?? [];
      liste.push(listener as (raw: never) => void);
      dinleyiciler.set(event, liste);
    },
    off() {},
    async getStatus() {
      return { playerCount: 0, publicQueue: 0 };
    },
    async getPlayers() {
      return [];
    },
    async rconExecute() {
      return '';
    },
  } satisfies SquadJSEngine;

  const adapter = createSquadJSAdapter({
    serverSlug: 'squad-01',
    engine,
    onEvent: (e) => olaylar.push(e),
    snapshotIntervalMs: 10 ** 7,
  });
  adapter.start();

  const yay = (event: string, raw: unknown) => {
    for (const l of dinleyiciler.get(event) ?? []) (l as (r: unknown) => void)(raw);
  };

  const adminOlaylari = () => olaylar.filter((o) => o.type === 'ADMIN_ACTION');
  return { yay, adminOlaylari };
}

const ZAMAN = new Date('2026-08-10T18:00:00.000Z');

describe('yetkili işlemleri', () => {
  it('uyarıyı metniyle birlikte taşır', () => {
    const { yay, adminOlaylari } = kurulum();
    yay('PLAYER_WARNED', { name: 'Mrkosak', reason: 'küfür etme', time: ZAMAN });

    const o = adminOlaylari()[0];
    expect(o).toMatchObject({
      type: 'ADMIN_ACTION',
      action: 'warn',
      playerName: 'Mrkosak',
      message: 'küfür etme',
    });
  });

  it('uyarıda kimlik yoksa alanı hiç koymaz — isim yeter', () => {
    const { yay, adminOlaylari } = kurulum();
    yay('PLAYER_WARNED', { name: 'Mrkosak', reason: 'x', time: ZAMAN });

    const o = adminOlaylari()[0];
    expect(o && 'steamId' in o).toBe(false);
  });

  it('atma olayında kimliği taşır', () => {
    const { yay, adminOlaylari } = kurulum();
    yay('PLAYER_KICKED', {
      name: 'Berkay',
      steamID: '76561198432943263',
      reason: 'troll',
      time: ZAMAN,
    });

    expect(adminOlaylari()[0]).toMatchObject({
      action: 'kick',
      steamId: '76561198432943263',
    });
  });

  it('banda süreyi taşır', () => {
    const { yay, adminOlaylari } = kurulum();
    yay('PLAYER_BANNED', { name: 'Ali', interval: '3d', time: ZAMAN });

    expect(adminOlaylari()[0]).toMatchObject({ action: 'ban', interval: '3d' });
  });

  it('duyuru metnini message alanından okur', () => {
    const { yay, adminOlaylari } = kurulum();
    yay('ADMIN_BROADCAST', { message: 'Sunucu 10 dk sonra yeniden başlıyor', time: ZAMAN });

    expect(adminOlaylari()[0]).toMatchObject({
      action: 'broadcast',
      message: 'Sunucu 10 dk sonra yeniden başlıyor',
    });
  });

  it('admin kamerasına giriş ve çıkışı ayırır', () => {
    const { yay, adminOlaylari } = kurulum();
    yay('POSSESSED_ADMIN_CAMERA', { name: 'Yetkili', time: ZAMAN });
    yay('UNPOSSESSED_ADMIN_CAMERA', { name: 'Yetkili', time: ZAMAN });

    expect(adminOlaylari().map((o) => o.type === 'ADMIN_ACTION' && o.action)).toEqual([
      'cam_enter',
      'cam_exit',
    ]);
  });

  it('ürettiği olay sözleşmeyi geçer', () => {
    const { yay, adminOlaylari } = kurulum();
    yay('PLAYER_WARNED', { name: 'Mrkosak', reason: 'küfür', time: ZAMAN });

    // Sözleşmeyi geçemeyen olay api tarafında SESSİZCE düşüyor; en pahalı
    // hata biçimi bu, o yüzden burada doğrulanıyor.
    expect(AgentEventSchema.safeParse(adminOlaylari()[0]).success).toBe(true);
  });

  it('boş isimli işlemi isimsiz gönderir, uydurmaz', () => {
    const { yay, adminOlaylari } = kurulum();
    yay('PLAYER_WARNED', { name: '   ', reason: 'x', time: ZAMAN });

    const o = adminOlaylari()[0];
    expect(o && 'playerName' in o).toBe(false);
  });
});
