import type { AgentEvent } from '@altai/contracts';
import { describe, expect, it } from 'vitest';
import { createSquadJSAdapter } from '../src/adapter.js';
import type {
  SquadJSEngine,
  SquadJSEngineEvents,
  SquadJSNewGameRaw,
  SquadJSOnlinePlayer,
  SquadJSRoundEndedRaw,
} from '../src/engine.js';

/**
 * Maç kaydı SquadJS'in ham log verisinden türetiliyor ve ham veri düzensiz:
 * takım/ticket string geliyor, beraberlikte kazanan null oluyor, layer
 * katalogdan çözülemeyebiliyor. Bu testler o dönüşümü kilitliyor — bozulursa
 * maç istatistikleri sessizce yanlış olur, hata vermez.
 */

function kurulum(cevrimici: SquadJSOnlinePlayer[] = []) {
  const dinleyiciler = new Map<string, ((raw: never) => void)[]>();
  const olaylar: AgentEvent[] = [];

  const engine: SquadJSEngine = {
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
      return cevrimici;
    },
    async refreshPlayers() {},
    async rconExecute() {
      return '';
    },
  };

  const adapter = createSquadJSAdapter({
    serverSlug: 'squad-01',
    engine,
    onEvent: (e) => olaylar.push(e),
    // Testte zamanlayıcı istemiyoruz; snapshot'ı çok ileriye atıyoruz.
    snapshotIntervalMs: 10 ** 7,
  });
  adapter.start();

  const yay = (event: string, raw: unknown) => {
    for (const l of dinleyiciler.get(event) ?? []) (l as (r: unknown) => void)(raw);
  };

  return { olaylar, yay, adapter, engine };
}

/**
 * ROUND_ENDED artık asenkron: skorbord satırları maç sonundaki takım/manga
 * bilgisiyle tazelenirken RCON oyuncu listesi bekleniyor. Olayı okumadan
 * önce o mikro görevin bitmesi gerekiyor.
 */
const bekle = () => new Promise<void>((r) => setImmediate(r));

/**
 * Maç bitişi olayını bulur. Dizideki İLK olaya bakmak artık yanlış:
 * adapter.start() bir snapshot başlatıyor ve o da asenkron — beklemeye
 * başladığımız anda araya giriyor.
 */
const macBitisi = (olaylar: AgentEvent[]) =>
  olaylar.find((e) => e.type === 'ROUND_ENDED') as Extract<AgentEvent, { type: 'ROUND_ENDED' }>;

const ZAMAN = new Date('2026-08-09T18:00:00.000Z');

describe('maç başlangıcı', () => {
  it('layer katalogdan çözülünce okunabilir adı kullanır', () => {
    const { olaylar, yay } = kurulum();
    const raw: SquadJSNewGameRaw = {
      layer: { name: 'Yehorivka RAAS v1', map: { name: 'Yehorivka' } },
      layerClassname: 'Yehorivka_RAAS_v1',
      time: ZAMAN,
    };
    yay('NEW_GAME', raw);

    expect(olaylar).toHaveLength(1);
    expect(olaylar[0]).toEqual({
      type: 'ROUND_STARTED',
      serverSlug: 'squad-01',
      layer: 'Yehorivka RAAS v1',
      map: 'Yehorivka',
      timestamp: ZAMAN.toISOString(),
    });
  });

  it('layer çözülemezse classname ile kaydeder — maçı düşürmez', () => {
    const { olaylar, yay } = kurulum();
    yay('NEW_GAME', {
      layer: null,
      layerClassname: 'Narva_RAAS_v1',
      mapClassname: 'Narva',
      time: ZAMAN,
    } satisfies SquadJSNewGameRaw);

    expect(olaylar[0]).toMatchObject({ layer: 'Narva_RAAS_v1', map: 'Narva' });
  });
});

describe('maç bitişi', () => {
  it('kazanan takımı, fraksiyonu ve ticket sayısını sayıya çevirir', async () => {
    const { olaylar, yay } = kurulum();
    yay('ROUND_ENDED', {
      winner: { team: '2', faction: 'USA', tickets: '250' },
      loser: { team: '1', faction: 'RGF', tickets: '0' },
      time: ZAMAN,
    } satisfies SquadJSRoundEndedRaw);
    await bekle();

    expect(macBitisi(olaylar)).toEqual({
      type: 'ROUND_ENDED',
      serverSlug: 'squad-01',
      winnerTeam: 2,
      winnerFaction: 'USA',
      winnerTickets: 250,
      loserFaction: 'RGF',
      loserTickets: 0,
      timestamp: ZAMAN.toISOString(),
    });
  });

  it('beraberlikte kazanan alanlarını hiç göndermez', async () => {
    const { olaylar, yay } = kurulum();
    yay('ROUND_ENDED', { winner: null, loser: null, time: ZAMAN } satisfies SquadJSRoundEndedRaw);
    await bekle();

    // Uydurma değer değil, alanın YOKLUĞU bekleniyor: null bir kazanan
    // yazmak "1. takım kazandı" kadar yanlış olurdu.
    expect(macBitisi(olaylar)).toEqual({
      type: 'ROUND_ENDED',
      serverSlug: 'squad-01',
      timestamp: ZAMAN.toISOString(),
    });
  });

  it('takım numarası bozuksa o alanı atlar', async () => {
    const { olaylar, yay } = kurulum();
    yay('ROUND_ENDED', {
      winner: { team: 'Unknown', faction: 'USA', tickets: 'NaN' },
      time: ZAMAN,
    } satisfies SquadJSRoundEndedRaw);
    await bekle();

    expect(macBitisi(olaylar)).not.toHaveProperty('winnerTeam');
    expect(macBitisi(olaylar)).not.toHaveProperty('winnerTickets');
    expect(macBitisi(olaylar)).toMatchObject({ winnerFaction: 'USA' });
  });
});

/**
 * Skorbordun adapter'a bağlanması.
 *
 * Buradaki testler biriktiricinin kendi kurallarını (o `scoreboard.test.ts`de)
 * değil, BAĞLANTIYI koruyor: sayaçlar doğru maça mı yazılıyor, maç sonunda
 * sıfırlanıyor mu, RCON yanıt vermezse skorbord düşüyor mu.
 */
describe('maç skorbordu', () => {
  const OYUNCU_A = { steamID: '76561190000000001', eosID: 'eos-a', name: 'Ali', teamID: 1 };
  const OYUNCU_B = { steamID: '76561190000000002', eosID: 'eos-b', name: 'Veli', teamID: 2 };

  it('ölüm ve canlandırmaları maç sonu olayına bindirir', async () => {
    const { olaylar, yay } = kurulum();
    yay('NEW_GAME', { layer: null, layerClassname: 'Narva_RAAS_v1', time: ZAMAN });
    yay('PLAYER_DIED', {
      victim: OYUNCU_B,
      attacker: OYUNCU_A,
      weapon: 'BP_AK74',
      teamkill: false,
    });
    yay('PLAYER_DIED', {
      victim: OYUNCU_B,
      attacker: OYUNCU_A,
      weapon: 'BP_AK74',
      teamkill: false,
    });
    yay('PLAYER_REVIVED', { reviver: OYUNCU_B, victim: OYUNCU_A });
    yay('ROUND_ENDED', { winner: { team: '1' }, time: ZAMAN });
    await bekle();

    const son = macBitisi(olaylar);
    const ali = son.players?.find((p) => p.eosId === 'eos-a');
    const veli = son.players?.find((p) => p.eosId === 'eos-b');
    // Ali hiç ölmedi: canlandırılmak ölüm sayısını artırmaz, onu Veli
    // canlandırdı diye Ali'ye ölüm yazmak sayacı ikilerdi.
    expect(ali).toMatchObject({ kills: 2, deaths: 0, killstreak: 2, weapons: { BP_AK74: 2 } });
    expect(veli).toMatchObject({ kills: 0, deaths: 2, revives: 1 });
  });

  it('yeni maç sayaçları sıfırlar — önceki maç sızmaz', async () => {
    const { olaylar, yay } = kurulum();
    yay('PLAYER_DIED', { victim: OYUNCU_B, attacker: OYUNCU_A, teamkill: false });
    yay('NEW_GAME', { layer: null, layerClassname: 'Narva_RAAS_v1', time: ZAMAN });
    yay('ROUND_ENDED', { winner: { team: '1' }, time: ZAMAN });
    await bekle();

    // Skorbord boş: alan HİÇ gönderilmiyor. Boş dizi "maçta kimse yoktu"
    // demek olurdu; alanın yokluğu "istatistik yok" demek.
    expect(macBitisi(olaylar)).not.toHaveProperty('players');
  });

  it('maç sonu takım bilgisini RCON listesinden tazeler', async () => {
    // Oyuncu maç içinde 1. takımdayken öldürdü, maç sonunda 2. takımda.
    // Kazanan/kaybeden ayrımı maç SONUNDAKİ takıma bakıyor.
    const { olaylar, yay } = kurulum([
      {
        steamId: '76561190000000001',
        eosId: 'eos-a',
        name: 'Ali',
        teamId: 2,
        squadId: 3,
        squadName: 'CMD',
        role: 'SL',
        isLeader: true,
      },
    ]);
    yay('PLAYER_DIED', { victim: OYUNCU_B, attacker: OYUNCU_A, teamkill: false });
    yay('ROUND_ENDED', { winner: { team: '2' }, time: ZAMAN });
    await bekle();

    const son = macBitisi(olaylar);
    expect(son.players?.find((p) => p.eosId === 'eos-a')).toMatchObject({
      teamId: 2,
      squadId: 3,
      role: 'SL',
      isLeader: true,
      kills: 1,
    });
  });

  it('RCON yanıt vermezse skorbordu yine gönderir', async () => {
    const { olaylar, yay, engine } = kurulum();
    engine.getPlayers = async () => {
      throw new Error('rcon timeout');
    };
    yay('PLAYER_DIED', { victim: OYUNCU_B, attacker: OYUNCU_A, teamkill: false });
    yay('ROUND_ENDED', { winner: { team: '1' }, time: ZAMAN });
    await bekle();

    // Eksik takım bilgisi yüzünden tüm maçı düşürmek çok daha pahalı.
    const son = macBitisi(olaylar);
    expect(son.players).toHaveLength(2);
  });
});
