import type { AgentEvent, AgentQuery } from '@altai/contracts';
import type { SquadJSEngine, SquadJSOnlinePlayer } from '@altai/squad';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginHost } from '../src/plugin-host.js';
import { myStats } from '../src/plugins/my-stats.js';

/**
 * `!stats` komutunun davranışı.
 *
 * Kilitlenen asıl kural: "istatistiğin yok" ile "şu an ulaşamıyoruz" AYRI
 * cevaplar. api kopukken oyuncuya "hiç maçın yok" demek, ona verisinin
 * silindiğini düşündürürdü — eski sistemde tam olarak bu şikâyet geliyordu.
 */

interface SahteEngine extends SquadJSEngine {
  komutlar: string[];
  oyuncular: SquadJSOnlinePlayer[];
}

function sahteEngine(): SahteEngine {
  const komutlar: string[] = [];
  const oyuncular: SquadJSOnlinePlayer[] = [];
  const e = {
    serverSlug: 'squad-01',
    komutlar,
    oyuncular,
    on: () => undefined,
    off: () => undefined,
    getPlayers: async () => oyuncular,
    refreshPlayers: async () => undefined,
    getStatus: async () => ({ playerCount: oyuncular.length, publicQueue: 0 }),
    rconExecute: async (cmd: string) => {
      komutlar.push(cmd);
      return 'ok';
    },
  } as unknown as SahteEngine;
  return e;
}

const STEAM = '76561190000000001';

function sohbet(mesaj: string, steamId = STEAM): AgentEvent {
  return {
    type: 'CHAT_MESSAGE',
    serverSlug: 'squad-01',
    steamId,
    channel: 'All',
    message: mesaj,
    timestamp: new Date().toISOString(),
  };
}

const DOLU_ISTATISTIK = {
  bulundu: true,
  rounds: 40,
  kills: 120,
  deaths: 60,
  revives: 15,
  teamkills: 2,
  bestKillstreak: 7,
  damageDealt: 9000,
  damageTaken: 8000,
  wins: 22,
  losses: 18,
  kdr: 2,
  winRate: 55,
  topWeapons: [{ weapon: 'BP_AK74', kills: 40 }],
};

async function kur(cevap: unknown | null, config: Record<string, unknown> = {}) {
  const e = sahteEngine();
  const sorulan: AgentQuery[] = [];
  const h = new PluginHost({
    serverSlug: 'squad-01',
    engine: e,
    emit: () => undefined,
    sorgu: async (q) => {
      sorulan.push(q);
      return cevap;
    },
  });
  h.register(myStats);
  await h.applyConfigs([
    { pluginName: 'my-stats', enabled: true, config: { cooldownSeconds: 0, ...config } },
  ]);
  return { e, h, sorulan };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('!stats', () => {
  it('istatistiği olan oyuncuya sayıları gösterir', async () => {
    const { e, h } = await kur(DOLU_ISTATISTIK);
    await h.handleEvent(sohbet('!stats'));

    const metin = e.komutlar.join('\n');
    expect(metin).toContain('K/D 2');
    expect(metin).toContain('120 öldürme');
    expect(metin).toContain('en uzun seri 7');
    expect(metin).toContain('BP_AK74');
  });

  it('api ULAŞILAMAZSA "maçın yok" demez', async () => {
    // Kritik ayrım: null = bilmiyoruz. Oyuncuya verisinin silindiğini
    // düşündürecek bir cevap vermek, sessiz bir hatadan daha kötü.
    const { e, h } = await kur(null);
    await h.handleEvent(sohbet('!stats'));

    const metin = e.komutlar.join('\n');
    expect(metin).toContain('alınamıyor');
    expect(metin).not.toContain('Henüz kayıtlı maçın yok');
  });

  it('gerçekten maçı olmayana ne yapması gerektiğini söyler', async () => {
    const { e, h } = await kur({ ...DOLU_ISTATISTIK, bulundu: false, rounds: 0 });
    await h.handleEvent(sohbet('!stats'));
    expect(e.komutlar.join('\n')).toContain('Henüz kayıtlı maçın yok');
  });

  it('bekleme süresi dolmadan tekrar sorana sessiz kalmaz', async () => {
    // Sessizlik, oyuncunun komutun çalışmadığını sanıp arka arkaya
    // yazmasına yol açıyordu.
    const { e, h } = await kur(DOLU_ISTATISTIK, { cooldownSeconds: 60 });
    await h.handleEvent(sohbet('!stats'));
    const ilkSayi = e.komutlar.length;

    await h.handleEvent(sohbet('!stats'));
    const yeni = e.komutlar.slice(ilkSayi).join('\n');
    expect(yeni).toContain('yavaş');
  });

  it('bekleme süresi oyuncu başına — başkası etkilenmez', async () => {
    const { e, h } = await kur(DOLU_ISTATISTIK, { cooldownSeconds: 60 });
    await h.handleEvent(sohbet('!stats'));
    e.komutlar.length = 0;

    await h.handleEvent(sohbet('!stats', '76561190000000002'));
    expect(e.komutlar.join('\n')).not.toContain('yavaş');
  });

  it('yapılandırılmamış kanaldan gelen komutu yok sayar', async () => {
    const { e, h } = await kur(DOLU_ISTATISTIK, { channels: ['Admin'] });
    await h.handleEvent(sohbet('!stats'));
    expect(e.komutlar).toEqual([]);
  });

  it('başka bir komuta karışmaz', async () => {
    const { e, h } = await kur(DOLU_ISTATISTIK);
    await h.handleEvent(sohbet('!admin yardım'));
    expect(e.komutlar).toEqual([]);
  });

  it('days ayarı sorguya geçiyor', async () => {
    const { h, sorulan } = await kur(DOLU_ISTATISTIK, { days: 30 });
    await h.handleEvent(sohbet('!stats'));
    expect(sorulan[0]).toMatchObject({ kind: 'player_stats', days: 30 });
  });
});

describe('!top', () => {
  const LISTE = [
    {
      playerId: 'a',
      steamId: null,
      name: 'Ali',
      rounds: 40,
      kills: 120,
      deaths: 60,
      revives: 5,
      kdr: 2,
    },
    {
      playerId: 'b',
      steamId: null,
      name: 'Veli',
      rounds: 30,
      kills: 60,
      deaths: 60,
      revives: 9,
      kdr: 1,
    },
  ];

  it('sıralamayı sırayla gösterir', async () => {
    const { e, h } = await kur(LISTE);
    await h.handleEvent(sohbet('!top'));

    const metin = e.komutlar.join('\n');
    expect(metin).toContain('1. Ali');
    expect(metin).toContain('2. Veli');
  });

  it('boş sıralamada eşiği söyler', async () => {
    // "Sıralama boş" tek başına "kimse oynamadı" gibi okunurdu; sebep
    // genelde kimsenin eşiği geçmemiş olması.
    const { e, h } = await kur([], { topMinRounds: 25 });
    await h.handleEvent(sohbet('!top'));
    expect(e.komutlar.join('\n')).toContain('25 maç');
  });

  it('topCommand boşsa sıralama komutu kapalı', async () => {
    const { e, h } = await kur(LISTE, { topCommand: '' });
    await h.handleEvent(sohbet('!top'));
    expect(e.komutlar).toEqual([]);
  });

  it('minRounds sorguya geçiyor', async () => {
    const { h, sorulan } = await kur(LISTE, { topMinRounds: 15, topMetric: 'kills' });
    await h.handleEvent(sohbet('!top'));
    expect(sorulan[0]).toMatchObject({ kind: 'leaderboard', metric: 'kills', minRounds: 15 });
  });
});
