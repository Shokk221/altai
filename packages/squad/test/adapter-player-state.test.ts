import type { AgentEvent } from '@altai/contracts';
import { describe, expect, it } from 'vitest';
import { createSquadJSAdapter } from '../src/adapter.js';
import type {
  SquadJSEngine,
  SquadJSEngineEvents,
  SquadJSPlayerStateChangeRaw,
  SquadJSSquadCreatedRaw,
  SquadJSTeamkillRaw,
} from '../src/engine.js';

/**
 * Oyuncu durumu diff'leri, TK ve manga kurma.
 *
 * Bu üç olay eski sistemdeki dört plugin'in tetikleyicisiydi (SL kit
 * denetimi, SL ban, mangasız atma, TK uyarısı) ve hiçbiri `AgentEvent`
 * sözleşmesinde yoktu — yani o plugin'ler portlanamıyordu.
 *
 * `SQUAD_CREATED.teamId` ayrıca kritik: `AdminDisbandSquad <teamID>
 * <squadID>` bunu istiyor ve RCON satırında yalnızca takım ADI var.
 * Alan çözümlenmiş oyuncu kaydından geliyor; kaybolursa manga dağıtan
 * plugin sessizce hiçbir şey yapmaz.
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
    async getPlayers() {
      return [];
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
    snapshotIntervalMs: 10 ** 7,
  });
  adapter.start();

  const tetikle = (event: string, raw: unknown) => {
    for (const l of dinleyiciler.get(event) ?? []) (l as (r: unknown) => void)(raw);
  };

  return { olaylar, tetikle, adapter };
}

const OYUNCU = {
  steamID: '76561190000000001',
  eosID: 'a'.repeat(32),
  name: 'Test Oyuncu',
  teamID: 2,
  squadID: 3,
  isLeader: true,
  role: 'USA_SL_01',
};

describe('PLAYER_STATE_CHANGE', () => {
  it('rol değişimini taşır', () => {
    const { olaylar, tetikle } = kurulum();
    const raw: SquadJSPlayerStateChangeRaw = {
      player: OYUNCU,
      oldRole: 'USA_Rifleman_01',
      newRole: 'USA_SL_01',
      time: new Date('2026-01-01T12:00:00Z'),
    };
    tetikle('PLAYER_ROLE_CHANGE', raw);

    expect(olaylar).toHaveLength(1);
    const e = olaylar[0];
    expect(e).toMatchObject({
      type: 'PLAYER_STATE_CHANGE',
      change: 'role',
      steamId: OYUNCU.steamID,
      eosId: OYUNCU.eosID,
      playerName: 'Test Oyuncu',
      teamId: 2,
      squadId: 3,
      isLeader: true,
      role: 'USA_SL_01',
      oldRole: 'USA_Rifleman_01',
    });
  });

  it('dört değişim türü ayrı ayrı işaretlenir', () => {
    const { olaylar, tetikle } = kurulum();
    const raw: SquadJSPlayerStateChangeRaw = { player: OYUNCU };
    tetikle('PLAYER_ROLE_CHANGE', raw);
    tetikle('PLAYER_SQUAD_CHANGE', { ...raw, oldSquadID: 1 });
    tetikle('PLAYER_NOW_IS_LEADER', raw);
    tetikle('PLAYER_NOW_IS_NOT_LEADER', { ...raw, player: { ...OYUNCU, isLeader: false } });

    expect(olaylar.map((e) => (e as { change: string }).change)).toEqual([
      'role',
      'squad',
      'became_leader',
      'lost_leader',
    ]);
    // Liderliği kaybeden oyuncuda bayrak da düşmeli — plugin buna bakıyor.
    expect((olaylar[3] as { isLeader: boolean }).isLeader).toBe(false);
  });

  it('kimliksiz diff olay üretmez', () => {
    // Kimliği olmayan bir oyuncuya hiçbir plugin işlem uygulayamaz; olayı
    // üretmek yalnızca gürültü olurdu.
    const { olaylar, tetikle } = kurulum();
    tetikle('PLAYER_ROLE_CHANGE', {
      player: { name: 'Kimliksiz', steamID: '', eosID: undefined },
    });
    tetikle('PLAYER_ROLE_CHANGE', { player: null });
    expect(olaylar).toHaveLength(0);
  });

  it('eksik alanlar hiç konmaz, boş değerle doldurulmaz', () => {
    const { olaylar, tetikle } = kurulum();
    tetikle('PLAYER_ROLE_CHANGE', {
      player: { steamID: '76561190000000002', name: 'Sade', eosID: undefined },
    });
    const e = olaylar[0] as Record<string, unknown>;
    expect('eosId' in e).toBe(false);
    expect('teamId' in e).toBe(false);
    expect('squadId' in e).toBe(false);
    // isLeader her zaman var: üç durumlu olmamalı, plugin `if (isLeader)`
    // yazabilmeli.
    expect(e.isLeader).toBe(false);
  });
});

describe('TEAMKILL', () => {
  it('saldırgan ve kurbanı taşır', () => {
    const { olaylar, tetikle } = kurulum();
    const raw: SquadJSTeamkillRaw = {
      attacker: { steamID: '76561190000000001', eosID: 'a'.repeat(32), name: 'Suçlu' },
      victim: { steamID: '76561190000000002', eosID: 'b'.repeat(32), name: 'Kurban' },
      weapon: 'BP_M4A1',
      time: new Date('2026-01-01T12:00:00Z'),
    };
    tetikle('TEAMKILL', raw);

    expect(olaylar[0]).toMatchObject({
      type: 'TEAMKILL',
      attackerName: 'Suçlu',
      victimName: 'Kurban',
      weapon: 'BP_M4A1',
      timestamp: '2026-01-01T12:00:00.000Z',
    });
  });

  it('yalnızca kurban bilindiğinde de olay üretilir', () => {
    // Saldırgan controller'dan çözülemeyebiliyor; olayı düşürmek TK'nın
    // hiç yaşanmamış gibi görünmesi demekti.
    const { olaylar, tetikle } = kurulum();
    tetikle('TEAMKILL', { victim: { steamID: '76561190000000002', name: 'Kurban' } });
    expect(olaylar).toHaveLength(1);
    expect((olaylar[0] as Record<string, unknown>).attackerName).toBeUndefined();
  });

  it('ikisi de yoksa olay üretilmez', () => {
    const { olaylar, tetikle } = kurulum();
    tetikle('TEAMKILL', { weapon: 'BP_M4A1' });
    expect(olaylar).toHaveLength(0);
  });
});

describe('SQUAD_CREATED.teamId', () => {
  it('çözümlenmiş oyuncudan takım kimliğini alır', () => {
    const { olaylar, tetikle } = kurulum();
    const raw: SquadJSSquadCreatedRaw = {
      player: { name: 'Lider', steamID: '76561190000000001', teamID: 2 },
      squadID: 3,
      squadName: 'ALFA',
      teamName: 'United States Army',
      time: new Date('2026-01-01T12:00:00Z'),
    };
    tetikle('SQUAD_CREATED', raw);

    expect(olaylar[0]).toMatchObject({
      type: 'SQUAD_CREATED',
      squadId: '3',
      squadName: 'ALFA',
      teamName: 'United States Army',
      teamId: 2,
    });
  });

  it('takım kimliği yoksa alan hiç konmaz', () => {
    // AdminDisbandSquad çağrısı bu alana bakıyor; `0` ya da `null` yazmak
    // "takım 0" gibi geçerli görünen yanlış bir komut üretirdi.
    const { olaylar, tetikle } = kurulum();
    tetikle('SQUAD_CREATED', {
      player: { name: 'Lider', steamID: '76561190000000001' },
      squadID: 3,
      squadName: 'ALFA',
    });
    expect('teamId' in (olaylar[0] as Record<string, unknown>)).toBe(false);
  });
});
