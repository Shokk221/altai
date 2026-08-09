import type { AgentEvent } from '@altai/contracts';
import { describe, expect, it } from 'vitest';
import { createSquadJSAdapter } from '../src/adapter.js';
import type {
  SquadJSEngine,
  SquadJSEngineEvents,
  SquadJSNewGameRaw,
  SquadJSRoundEndedRaw,
} from '../src/engine.js';

/**
 * Maç kaydı SquadJS'in ham log verisinden türetiliyor ve ham veri düzensiz:
 * takım/ticket string geliyor, beraberlikte kazanan null oluyor, layer
 * katalogdan çözülemeyebiliyor. Bu testler o dönüşümü kilitliyor — bozulursa
 * maç istatistikleri sessizce yanlış olur, hata vermez.
 */

function kurulum() {
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

  return { olaylar, yay, adapter };
}

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
  it('kazanan takımı, fraksiyonu ve ticket sayısını sayıya çevirir', () => {
    const { olaylar, yay } = kurulum();
    yay('ROUND_ENDED', {
      winner: { team: '2', faction: 'USA', tickets: '250' },
      loser: { team: '1', faction: 'RGF', tickets: '0' },
      time: ZAMAN,
    } satisfies SquadJSRoundEndedRaw);

    expect(olaylar[0]).toEqual({
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

  it('beraberlikte kazanan alanlarını hiç göndermez', () => {
    const { olaylar, yay } = kurulum();
    yay('ROUND_ENDED', { winner: null, loser: null, time: ZAMAN } satisfies SquadJSRoundEndedRaw);

    // Uydurma değer değil, alanın YOKLUĞU bekleniyor: null bir kazanan
    // yazmak "1. takım kazandı" kadar yanlış olurdu.
    expect(olaylar[0]).toEqual({
      type: 'ROUND_ENDED',
      serverSlug: 'squad-01',
      timestamp: ZAMAN.toISOString(),
    });
  });

  it('takım numarası bozuksa o alanı atlar', () => {
    const { olaylar, yay } = kurulum();
    yay('ROUND_ENDED', {
      winner: { team: 'Unknown', faction: 'USA', tickets: 'NaN' },
      time: ZAMAN,
    } satisfies SquadJSRoundEndedRaw);

    expect(olaylar[0]).not.toHaveProperty('winnerTeam');
    expect(olaylar[0]).not.toHaveProperty('winnerTickets');
    expect(olaylar[0]).toMatchObject({ winnerFaction: 'USA' });
  });
});
