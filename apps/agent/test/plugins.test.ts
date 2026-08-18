import type { AdminIdentity, AgentEvent, AgentQuery } from '@altai/contracts';
import type { SquadJSEngine, SquadJSOnlinePlayer } from '@altai/squad';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginHost } from '../src/plugin-host.js';
import {
  adminCamWatchlist,
  adminRequest,
  autoSeedScheduler,
  autoTkWarn,
  cblInfo,
  chatCommands,
  eliteCommander,
  fogOfWar,
  nameEnforcer,
  playtimeSquadGuard,
  seedTracker,
  seedingMode,
  slBanEnforcer,
  slKitEnforcer,
  squadClaim,
  squadJoinRequest,
  steamLevel,
  teamBalancer,
  teamRandomizer,
  teamSwitch,
  welcomeWarn,
} from '../src/plugins/index.js';

/**
 * Portlanan plugin'lerin davranışı.
 *
 * Her test eski plugin'in gerçek bir kararını kilitliyor — "şu durumda
 * oyuncuyu atma", "şu durumda mangadan çıkar" gibi. Bunlar canlı sunucuda
 * insanlara uygulanan yaptırımlar; sessizce değişmeleri en pahalı hata
 * sınıfı.
 */

interface SahteEngine extends SquadJSEngine {
  komutlar: string[];
  oyuncular: SquadJSOnlinePlayer[];
  layer: string | undefined;
}

function sahteEngine(): SahteEngine {
  const komutlar: string[] = [];
  const oyuncular: SquadJSOnlinePlayer[] = [];
  const e = {
    serverSlug: 'squad-01',
    komutlar,
    oyuncular,
    layer: 'Yehorivka_RAAS_v1',
    on: () => undefined,
    off: () => undefined,
    getPlayers: async () => oyuncular,
    refreshPlayers: async () => undefined,
    rconExecute: async (cmd: string) => {
      komutlar.push(cmd);
      return 'ok';
    },
  } as unknown as SahteEngine;

  // Define getStatus after e exists to avoid referencing the variable before initialization
  e.getStatus = async () => ({
    playerCount: oyuncular.length,
    publicQueue: 0,
    ...(e.layer ? { currentLayer: e.layer } : {}),
  });

  return e;
}

function host(
  engine: SquadJSEngine,
  admins: AdminIdentity[] = [],
  sorgu?: (query: AgentQuery) => Promise<unknown | null>,
) {
  const h = new PluginHost({
    serverSlug: 'squad-01',
    engine,
    emit: () => undefined,
    ...(sorgu ? { sorgu } : {}),
  });
  if (admins.length > 0) h.adminListesiniGuncelle(admins);
  return h;
}

const baglandi = (name: string, steamId = '76561190000000001', eosId?: string): AgentEvent => ({
  type: 'PLAYER_CONNECTED',
  serverSlug: 'squad-01',
  steamId,
  ...(eosId ? { eosId } : {}),
  name,
  timestamp: new Date().toISOString(),
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('welcome-warn', () => {
  it('gecikmeden ÖNCE mesaj göndermez', async () => {
    const e = sahteEngine();
    const h = host(e);
    h.register(welcomeWarn);
    await h.applyConfigs([
      { pluginName: 'welcome-warn', enabled: true, config: { delaySeconds: 20, message: 'Selam' } },
    ]);

    await h.handleEvent(baglandi('Ali'));
    await vi.advanceTimersByTimeAsync(19_000);
    expect(e.komutlar).toEqual([]);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(e.komutlar).toEqual(['AdminWarn 76561190000000001 Selam']);
  });

  it('oyuncu süre dolmadan çıkarsa mesaj İPTAL edilir', async () => {
    // Aksi hâlde bir sonraki girişinde bambaşka bir bağlamda gecikmiş bir
    // "hoş geldin" alıyordu.
    const e = sahteEngine();
    const h = host(e);
    h.register(welcomeWarn);
    await h.applyConfigs([
      { pluginName: 'welcome-warn', enabled: true, config: { delaySeconds: 20, message: 'Selam' } },
    ]);

    await h.handleEvent(baglandi('Ali'));
    await vi.advanceTimersByTimeAsync(5_000);
    await h.handleEvent({
      type: 'PLAYER_DISCONNECTED',
      serverSlug: 'squad-01',
      steamId: '76561190000000001',
      timestamp: new Date().toISOString(),
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(e.komutlar).toEqual([]);
  });

  it('plugin kapatılınca bekleyen mesaj gitmez', async () => {
    const e = sahteEngine();
    const h = host(e);
    h.register(welcomeWarn);
    await h.applyConfigs([
      { pluginName: 'welcome-warn', enabled: true, config: { delaySeconds: 20, message: 'Selam' } },
    ]);
    await h.handleEvent(baglandi('Ali'));

    await h.applyConfigs([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(e.komutlar).toEqual([]);
  });
});

describe('name-enforcer', () => {
  const cfg = { pluginName: 'name-enforcer', enabled: true, config: {} };

  async function kur(
    e: SahteEngine,
    config: Record<string, unknown> = {},
    admins: AdminIdentity[] = [],
  ) {
    const h = host(e, admins);
    h.register(nameEnforcer);
    await h.applyConfigs([{ ...cfg, config }]);
    return h;
  }

  it('Kiril karakterli ismi atar', async () => {
    const e = sahteEngine();
    const h = await kur(e);
    await h.handleEvent(baglandi('Игрок'));
    expect(e.komutlar[0]).toContain('AdminKick 76561190000000001');
  });

  it('CJK karakterli ismi atar', async () => {
    const e = sahteEngine();
    const h = await kur(e);
    await h.handleEvent(baglandi('玩家'));
    expect(e.komutlar).toHaveLength(1);
  });

  it('temiz ismi atmaz', async () => {
    const e = sahteEngine();
    const h = await kur(e);
    await h.handleEvent(baglandi('Mehmet [ALTAI]'));
    expect(e.komutlar).toEqual([]);
  });

  it('tek yasaklı karakter yeterli — oran aranmaz', async () => {
    // Eski plugin'in bilinçli kararı: "%50'den fazlası Kiril olsun" gibi bir
    // oran karışık isimlerde tutarsız sonuç veriyordu.
    const e = sahteEngine();
    const h = await kur(e);
    await h.handleEvent(baglandi('Playerи'));
    expect(e.komutlar).toHaveLength(1);
  });

  it('muaf SteamID atılmaz', async () => {
    const e = sahteEngine();
    const h = await kur(e, { exemptSteamIds: ['76561190000000001'] });
    await h.handleEvent(baglandi('Игрок'));
    expect(e.komutlar).toEqual([]);
  });

  it('seed haritasında atma yapılmaz', async () => {
    // Sunucu boşken oyuncu atmak, doldurmaya çalıştığın sunucuyu boşaltmak.
    const e = sahteEngine();
    e.layer = 'Sumari_Seed_v1';
    const h = await kur(e);
    await h.handleEvent(baglandi('Игрок'));
    expect(e.komutlar).toEqual([]);
  });

  it('seed muafiyeti kapatılabilir', async () => {
    const e = sahteEngine();
    e.layer = 'Sumari_Seed_v1';
    const h = await kur(e, { ignoreSeedLayers: false });
    await h.handleEvent(baglandi('Игрок'));
    expect(e.komutlar).toHaveLength(1);
  });

  it('gerçek admin muaf tutulur', async () => {
    const e = sahteEngine();
    const h = await kur(e, {}, [
      { steamId: '76561190000000001', groupName: 'Admin', permissions: 'changemap,kick,ban' },
    ]);
    await h.handleEvent(baglandi('Игрок'));
    expect(e.komutlar).toEqual([]);
  });

  it('YALNIZCA reserve yetkisi olan muaf DEĞİL', async () => {
    // Bağışçı/klan whitelist'i admin değildir. Karıştırmak "bağışçı olduğu
    // için kicklenmedi" demek olurdu.
    const e = sahteEngine();
    const h = await kur(e, {}, [
      { steamId: '76561190000000001', groupName: 'KlanWL', permissions: 'reserve' },
    ]);
    await h.handleEvent(baglandi('Игрок'));
    expect(e.komutlar).toHaveLength(1);
  });

  it('yetki listesi HİÇ gelmediyse muafiyet uygulanmaz', async () => {
    // Bilmediğimiz bir yetkiyi varmış gibi saymak, yasaklı isimli oyuncuyu
    // serbest bırakırdı.
    const e = sahteEngine();
    const h = await kur(e);
    await h.handleEvent(baglandi('Игрок'));
    expect(e.komutlar).toHaveLength(1);
  });

  it('admin muafiyeti kapatılabilir', async () => {
    const e = sahteEngine();
    const h = await kur(e, { exemptAdmins: false }, [
      { steamId: '76561190000000001', groupName: 'Admin', permissions: 'kick,ban' },
    ]);
    await h.handleEvent(baglandi('Игрок'));
    expect(e.komutlar).toHaveLength(1);
  });

  it('EOS ile de admin eşleşir', async () => {
    const e = sahteEngine();
    const eos = 'a'.repeat(32);
    const h = await kur(e, {}, [{ eosId: eos, groupName: 'Admin', permissions: 'kick' }]);
    await h.handleEvent(baglandi('Игрок', '76561190000000009', eos));
    expect(e.komutlar).toEqual([]);
  });

  it('EOS varsa kimlik olarak onu kullanır', async () => {
    const e = sahteEngine();
    const h = await kur(e);
    const eos = 'a'.repeat(32);
    await h.handleEvent(baglandi('Игрок', '76561190000000001', eos));
    expect(e.komutlar[0]).toContain(eos);
  });
});

describe('sl-kit-enforcer', () => {
  const lider = (over: Partial<SquadJSOnlinePlayer> = {}): SquadJSOnlinePlayer => ({
    steamId: '76561190000000001',
    eosId: 'a'.repeat(32),
    name: 'Lider',
    teamId: 1,
    squadId: 1,
    squadName: 'ALFA',
    role: 'USA_Rifleman_01',
    isLeader: true,
    ...over,
  });

  async function kur(e: SahteEngine, config: Record<string, unknown> = {}) {
    const h = host(e);
    h.register(slKitEnforcer);
    await h.applyConfigs([
      {
        pluginName: 'sl-kit-enforcer',
        enabled: true,
        config: { minPlayers: 1, checkIntervalSeconds: 10, removalAfterSeconds: 60, ...config },
      },
    ]);
    return h;
  }

  it('yanlış kitli lideri önce uyarır, atmaz', async () => {
    const e = sahteEngine();
    e.oyuncular.push(lider());
    await kur(e);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(e.komutlar.some((c) => c.startsWith('AdminWarn'))).toBe(true);
    expect(e.komutlar.some((c) => c.includes('AdminRemovePlayerFromSquad'))).toBe(false);
  });

  it('süre dolunca MANGADAN çıkarır — sunucudan atmaz', async () => {
    // Ceza ayrımı: kit almamak sunucudan atılmayı hak etmiyor.
    const e = sahteEngine();
    e.oyuncular.push(lider());
    await kur(e);

    await vi.advanceTimersByTimeAsync(80_000);
    expect(e.komutlar.some((c) => c.includes('AdminRemovePlayerFromSquad'))).toBe(true);
    expect(e.komutlar.some((c) => c.startsWith('AdminKick'))).toBe(false);
  });

  it('doğru kitli lidere dokunmaz', async () => {
    const e = sahteEngine();
    e.oyuncular.push(lider({ role: 'USA_SL_01' }));
    await kur(e);
    await vi.advanceTimersByTimeAsync(80_000);
    expect(e.komutlar).toEqual([]);
  });

  it('lider olmayana dokunmaz', async () => {
    const e = sahteEngine();
    e.oyuncular.push(lider({ isLeader: false }));
    await kur(e);
    await vi.advanceTimersByTimeAsync(80_000);
    expect(e.komutlar).toEqual([]);
  });

  it('sunucu eşiğin altındayken hiçbir şey yapmaz', async () => {
    const e = sahteEngine();
    e.oyuncular.push(lider());
    await kur(e, { minPlayers: 40 });
    await vi.advanceTimersByTimeAsync(80_000);
    expect(e.komutlar).toEqual([]);
  });

  it('oyuncu kiti düzeltirse ceza saati sıfırlanır', async () => {
    const e = sahteEngine();
    const p = lider();
    e.oyuncular.push(p);
    await kur(e);

    await vi.advanceTimersByTimeAsync(50_000); // henüz 60 sn dolmadı
    p.role = 'USA_SL_01'; // kiti aldı
    await vi.advanceTimersByTimeAsync(50_000); // toplam 100 sn

    expect(e.komutlar.some((c) => c.includes('AdminRemovePlayerFromSquad'))).toBe(false);
  });

  it('rol değişimi olayında beklemeden bakar', async () => {
    // Bir sonraki tarama turunu beklemek 30 saniye kaybettiriyordu.
    const e = sahteEngine();
    e.oyuncular.push(lider());
    const h = await kur(e, { checkIntervalSeconds: 300 });

    await h.handleEvent({
      type: 'PLAYER_STATE_CHANGE',
      serverSlug: 'squad-01',
      change: 'became_leader',
      steamId: '76561190000000001',
      playerName: 'Lider',
      isLeader: true,
      role: 'USA_Rifleman_01',
      timestamp: new Date().toISOString(),
    });

    expect(e.komutlar.some((c) => c.startsWith('AdminWarn'))).toBe(true);
  });
});

// ---------------------------------------------------------------- auto-tk-warn

const tk = (over: Record<string, unknown> = {}): AgentEvent =>
  ({
    type: 'TEAMKILL',
    serverSlug: 'squad-01',
    attackerName: 'Suçlu',
    attackerSteamId: '76561190000000001',
    attackerEosId: 'a'.repeat(32),
    victimName: 'Kurban',
    victimSteamId: '76561190000000002',
    victimEosId: 'b'.repeat(32),
    timestamp: new Date().toISOString(),
    ...over,
  }) as AgentEvent;

const sohbet = (steamId: string, message: string, channel = 'All'): AgentEvent =>
  ({
    type: 'CHAT_MESSAGE',
    serverSlug: 'squad-01',
    steamId,
    channel,
    message,
    timestamp: new Date().toISOString(),
  }) as AgentEvent;

describe('auto-tk-warn', () => {
  async function kur(e: SahteEngine, config: Record<string, unknown> = {}) {
    const h = host(e);
    h.register(autoTkWarn);
    await h.applyConfigs([
      {
        pluginName: 'auto-tk-warn',
        enabled: true,
        config: {
          kickAfterSeconds: 60,
          reminderIntervalSeconds: 30,
          seedingThreshold: 0,
          ...config,
        },
      },
    ]);
    return h;
  }

  it('TK sonrası uyarır, hemen atmaz', async () => {
    const e = sahteEngine();
    e.oyuncular.length = 0;
    const h = await kur(e);
    await h.handleEvent(tk());
    expect(e.komutlar.some((c) => c.startsWith('AdminWarn'))).toBe(true);
    expect(e.komutlar.some((c) => c.startsWith('AdminKick'))).toBe(false);
  });

  it('özür dilenmezse süre sonunda atar', async () => {
    const e = sahteEngine();
    const h = await kur(e);
    await h.handleEvent(tk());
    await vi.advanceTimersByTimeAsync(61_000);
    expect(e.komutlar.some((c) => c.startsWith('AdminKick'))).toBe(true);
  });

  it('ALL chat’te özür dilenirse atılmaz', async () => {
    const e = sahteEngine();
    const h = await kur(e);
    await h.handleEvent(tk());
    await h.handleEvent(sohbet('76561190000000001', 'özür dilerim arkadaşlar'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(e.komutlar.some((c) => c.startsWith('AdminKick'))).toBe(false);
  });

  it('admin kanalındaki özür sayılmaz', async () => {
    // Özür herkesin göreceği bir kanalda olmalı.
    const e = sahteEngine();
    const h = await kur(e);
    await h.handleEvent(tk());
    await h.handleEvent(sohbet('76561190000000001', 'özür', 'Admin'));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(e.komutlar.some((c) => c.startsWith('AdminKick'))).toBe(true);
  });

  it('kurban anlaşmalı TK derse ceza kalkar', async () => {
    const e = sahteEngine();
    const h = await kur(e);
    await h.handleEvent(tk());
    await h.handleEvent(sohbet('76561190000000002', '!anlaşmalıtk'));
    await vi.advanceTimersByTimeAsync(120_000);
    expect(e.komutlar.some((c) => c.startsWith('AdminKick'))).toBe(false);
  });

  it('ALAKASIZ biri anlaşmalı TK yazarsa ceza kalkmaz', async () => {
    const e = sahteEngine();
    const h = await kur(e);
    await h.handleEvent(tk());
    await h.handleEvent(sohbet('76561190000000009', '!anlaşmalıtk'));
    await vi.advanceTimersByTimeAsync(61_000);
    expect(e.komutlar.some((c) => c.startsWith('AdminKick'))).toBe(true);
  });

  it('round bitince bekleyen cezalar silinir', async () => {
    // Yeni round'da eski TK için kimse atılmamalı — temiz sayfa.
    const e = sahteEngine();
    const h = await kur(e);
    await h.handleEvent(tk());
    await h.handleEvent({
      type: 'ROUND_ENDED',
      serverSlug: 'squad-01',
      timestamp: new Date().toISOString(),
    } as AgentEvent);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(e.komutlar.some((c) => c.startsWith('AdminKick'))).toBe(false);
  });

  it('seed modunda TK uyarısı verilmez', async () => {
    const e = sahteEngine();
    const h = await kur(e, { seedingThreshold: 60 }); // 0 oyuncu < 60
    await h.handleEvent(tk());
    expect(e.komutlar).toEqual([]);
  });

  it('plugin kapatılınca bekleyen atma gitmez', async () => {
    const e = sahteEngine();
    const h = await kur(e);
    await h.handleEvent(tk());
    await h.applyConfigs([]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(e.komutlar.some((c) => c.startsWith('AdminKick'))).toBe(false);
  });
});

// -------------------------------------------------------- playtime-squad-guard

const mangaKuruldu = (over: Record<string, unknown> = {}): AgentEvent =>
  ({
    type: 'SQUAD_CREATED',
    serverSlug: 'squad-01',
    playerName: 'Lider',
    steamId: '76561190000000001',
    eosId: 'a'.repeat(32),
    squadId: '3',
    squadName: 'ALFA',
    teamId: 2,
    timestamp: new Date().toISOString(),
    ...over,
  }) as AgentEvent;

describe('playtime-squad-guard', () => {
  async function kur(
    e: SahteEngine,
    config: Record<string, unknown> = {},
    admins: AdminIdentity[] = [],
  ) {
    const h = new PluginHost({
      serverSlug: 'squad-01',
      engine: e,
      emit: () => undefined,
      secrets: { steamApiKey: 'test-key' },
    });
    if (admins.length > 0) h.adminListesiniGuncelle(admins);
    h.register(playtimeSquadGuard);
    await h.applyConfigs([
      { pluginName: 'playtime-squad-guard', enabled: true, config: { minHours: 100, ...config } },
    ]);
    return h;
  }

  /** Steam yanıtını sahteler: saat + profil görünürlüğü. */
  function steamSahtele(saat: number, gorunurluk = 3) {
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('GetPlayerSummaries')) {
        return {
          ok: true,
          json: async () => ({ response: { players: [{ communityvisibilitystate: gorunurluk }] } }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          response: { games: [{ appid: 393380, playtime_forever: saat * 60 }] },
        }),
      };
    });
  }

  afterEach(() => vi.unstubAllGlobals());

  it('saati yetersizse mangayı dağıtır', async () => {
    steamSahtele(50);
    const e = sahteEngine();
    const h = await kur(e);
    await h.handleEvent(mangaKuruldu());
    expect(e.komutlar).toContain('AdminDisbandSquad 2 3');
  });

  it('saati yeterliyse dokunmaz', async () => {
    steamSahtele(500);
    const e = sahteEngine();
    const h = await kur(e);
    await h.handleEvent(mangaKuruldu());
    expect(e.komutlar).toEqual([]);
  });

  it('takım kimliği YOKSA dağıtamaz, yalnızca uyarır', async () => {
    // teamId olmadan AdminDisbandSquad çağrılamıyor; sessizce geçmek
    // "engellendi" sanılmasına yol açardı.
    steamSahtele(50);
    const e = sahteEngine();
    const h = await kur(e);
    await h.handleEvent(mangaKuruldu({ teamId: undefined }));
    expect(e.komutlar.some((c) => c.startsWith('AdminWarn'))).toBe(true);
    expect(e.komutlar.some((c) => c.includes('AdminDisbandSquad'))).toBe(false);
  });

  it('gizli profil varsayılan olarak ENGELLEMEZ', async () => {
    // Profili kapalı tutmak kural ihlali değil.
    steamSahtele(500, 1);
    const e = sahteEngine();
    const h = await kur(e);
    await h.handleEvent(mangaKuruldu());
    expect(e.komutlar.some((c) => c.startsWith('AdminWarn'))).toBe(true);
    expect(e.komutlar.some((c) => c.includes('AdminDisbandSquad'))).toBe(false);
  });

  it('Steam ulaşılamazsa kimse cezalandırılmaz', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ağ hatası');
    });
    const e = sahteEngine();
    const h = await kur(e);
    await h.handleEvent(mangaKuruldu());
    expect(e.komutlar).toEqual([]);
  });

  it('admin muaf', async () => {
    steamSahtele(10);
    const e = sahteEngine();
    const h = await kur(e, {}, [
      { steamId: '76561190000000001', groupName: 'Admin', permissions: 'kick,ban' },
    ]);
    await h.handleEvent(mangaKuruldu());
    expect(e.komutlar).toEqual([]);
  });

  it('acemi mangada düşük eşik geçerli', async () => {
    steamSahtele(85);
    const e = sahteEngine();
    const h = await kur(e, { rookieEnabled: true, rookieMinHours: 80 });
    await h.handleEvent(mangaKuruldu({ squadName: 'ACEMI SL' }));
    expect(e.komutlar).toEqual([]);
  });
});

describe('sl-ban-enforcer', () => {
  /** Sorgu cevabını sabitleyen sahte kanal; kaç kez sorulduğunu da sayar. */
  function sahteSorgu(cevap: unknown | null) {
    const sorulan: AgentQuery[] = [];
    return {
      sorulan,
      fn: async (q: AgentQuery) => {
        sorulan.push(q);
        return cevap;
      },
    };
  }

  async function kur(e: SahteEngine, cevap: unknown | null, config: Record<string, unknown> = {}) {
    const s = sahteSorgu(cevap);
    // squadCreateDelayMs varsayılanı 1 sn; testlerin çoğunda beklemeye
    // gerek yok, gecikmeyi ayrı bir test kilitliyor.
    const h = host(e, [], s.fn);
    h.register(slBanEnforcer);
    await h.applyConfigs([
      {
        pluginName: 'sl-ban-enforcer',
        enabled: true,
        config: { squadCreateDelayMs: 0, sweepIntervalSeconds: 0, ...config },
      },
    ]);
    return { h, s };
  }

  const lider = (change: 'became_leader' | 'role', role?: string): AgentEvent => ({
    type: 'PLAYER_STATE_CHANGE',
    serverSlug: 'squad-01',
    change,
    steamId: '76561190000000001',
    playerName: 'Ali',
    isLeader: true,
    squadId: 1,
    teamId: 1,
    ...(role ? { role } : {}),
    timestamp: new Date().toISOString(),
  });

  const mangaKuruldu = (): AgentEvent => ({
    type: 'SQUAD_CREATED',
    serverSlug: 'squad-01',
    playerName: 'Ali',
    steamId: '76561190000000001',
    squadId: '1',
    squadName: 'ALPHA',
    teamId: 1,
    timestamp: new Date().toISOString(),
  });

  it('etiketi olan lideri uyarır ve mangadan ÇIKARIR (atmaz)', async () => {
    // Sunucudan atmak bambaşka ağırlıkta bir ceza; eski plugin de
    // AdminRemovePlayerFromSquad kullanıyordu.
    const e = sahteEngine();
    const { h } = await kur(e, { bulundu: true, flags: ['SL BAN'] });
    await h.handleEvent(lider('became_leader'));

    expect(e.komutlar).toEqual([
      'AdminWarn 76561190000000001 SL yasağın bulunuyor. Manga liderliğinden çıkarıldın.',
      'AdminRemovePlayerFromSquad "76561190000000001"',
    ]);
  });

  it('etiketi olmayan lidere dokunmaz', async () => {
    const e = sahteEngine();
    const { h } = await kur(e, { bulundu: true, flags: ['WATCHLIST'] });
    await h.handleEvent(lider('became_leader'));
    expect(e.komutlar).toEqual([]);
  });

  it('veritabanında hiç olmayan oyuncuya dokunmaz', async () => {
    // `bulundu: false` bir CEVAP: yeni oyuncunun etiketi olamaz.
    const e = sahteEngine();
    const { h } = await kur(e, { bulundu: false, flags: [] });
    await h.handleEvent(lider('became_leader'));
    expect(e.komutlar).toEqual([]);
  });

  it('sorgu cevapsız kalırsa (null) kimseye yaptırım uygulanmaz', async () => {
    // BURASI KRİTİK: "etiketi yok" ile "bilmiyoruz" ayrı şeyler. Bağlantı
    // koptuğu için birini mangadan çıkarmak, olmayan bir yasağı uygulamak
    // demek olurdu.
    const e = sahteEngine();
    const { h } = await kur(e, null);
    await h.handleEvent(lider('became_leader'));
    expect(e.komutlar).toEqual([]);
  });

  it('manga kuran yasaklıyı gecikmeden SONRA çıkarır', async () => {
    const e = sahteEngine();
    const { h } = await kur(e, { bulundu: true, flags: ['SL BAN'] }, { squadCreateDelayMs: 1_000 });

    const is = h.handleEvent(mangaKuruldu());
    await vi.advanceTimersByTimeAsync(0);
    expect(e.komutlar).toEqual([]);

    await vi.advanceTimersByTimeAsync(1_000);
    await is;
    expect(e.komutlar).toEqual([
      'AdminWarn 76561190000000001 SL yasağın bulunuyor. Manga liderliğinden çıkarıldın.',
      'AdminRemovePlayerFromSquad "76561190000000001"',
    ]);
  });

  it('gecikme sırasında plugin kapatılırsa komut GİTMEZ', async () => {
    // Kapalı bir plugin'in RCON komutu göndermesi hot-reload'ı anlamsız kılar.
    const e = sahteEngine();
    const { h } = await kur(e, { bulundu: true, flags: ['SL BAN'] }, { squadCreateDelayMs: 1_000 });

    const is = h.handleEvent(mangaKuruldu());
    await vi.advanceTimersByTimeAsync(0);
    await h.applyConfigs([]);
    await vi.advanceTimersByTimeAsync(5_000);
    await is;
    expect(e.komutlar).toEqual([]);
  });

  it('bekleme süresi içinde ikinci kez uyarmaz', async () => {
    // Mangadan çıkarma birden fazla olay tetikliyor; bu olmadan tek bir
    // çıkarma için üst üste uyarı gidiyordu.
    const e = sahteEngine();
    const { h } = await kur(e, { bulundu: true, flags: ['SL BAN'] }, { cooldownSeconds: 15 });

    await h.handleEvent(lider('became_leader'));
    expect(e.komutlar).toHaveLength(2);

    await h.handleEvent(lider('role', 'Squad Leader'));
    expect(e.komutlar).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(16_000);
    await h.handleEvent(lider('became_leader'));
    expect(e.komutlar).toHaveLength(4);
  });

  it('liderlik BIRAKMAYI denetlemez', async () => {
    // Yaptırımın hedeflediği duruma oyuncu kendisi son vermiş.
    const e = sahteEngine();
    const { h, s } = await kur(e, { bulundu: true, flags: ['SL BAN'] });
    await h.handleEvent({
      ...(lider('became_leader') as object),
      change: 'lost_leader',
    } as AgentEvent);
    expect(s.sorulan).toEqual([]);
    expect(e.komutlar).toEqual([]);
  });

  it('lider olmayan rol değişimi sorgu bile açmaz', async () => {
    // Her rol değişiminde veritabanına gitmek, kalabalık sunucuda dakikada
    // yüzlerce sorgu demek.
    const e = sahteEngine();
    const { h, s } = await kur(e, { bulundu: true, flags: ['SL BAN'] });
    await h.handleEvent({
      ...(lider('role', 'Rifleman') as object),
      isLeader: false,
    } as AgentEvent);
    expect(s.sorulan).toEqual([]);
  });

  it('etiket adı karşılaştırması harf duyarsız', async () => {
    const e = sahteEngine();
    const { h } = await kur(e, { bulundu: true, flags: ['sl ban'] });
    await h.handleEvent(lider('became_leader'));
    expect(e.komutlar).toHaveLength(2);
  });

  it('periyodik tarama olay kaçsa bile yakalar', async () => {
    // Eski sistemde tarama YOKTU (her sorgu BM'ye gidiyordu). Kendi
    // veritabanımızı sormak ucuz; cevapsız kalan sorgu bir sonraki turda
    // tekrar deneniyor.
    const e = sahteEngine();
    e.oyuncular.push({
      steamId: '76561190000000001',
      eosId: null,
      name: 'Ali',
      teamId: 1,
      squadId: 1,
      isLeader: true,
      role: 'USA_SL_01',
    } as SquadJSOnlinePlayer);

    const { h } = await kur(e, { bulundu: true, flags: ['SL BAN'] }, { sweepIntervalSeconds: 60 });
    expect(e.komutlar).toEqual([]);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(e.komutlar).toEqual([
      'AdminWarn 76561190000000001 SL yasağın bulunuyor. Manga liderliğinden çıkarıldın.',
      'AdminRemovePlayerFromSquad "76561190000000001"',
    ]);
  });

  it('taramada mangasız oyuncu sorgulanmaz', async () => {
    const e = sahteEngine();
    e.oyuncular.push({
      steamId: '76561190000000001',
      eosId: null,
      name: 'Ali',
      teamId: 1,
      squadId: null,
      isLeader: false,
      role: 'USA_SL_01',
    } as SquadJSOnlinePlayer);

    const { h, s } = await kur(
      e,
      { bulundu: true, flags: ['SL BAN'] },
      { sweepIntervalSeconds: 60 },
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.sorulan).toEqual([]);
    expect(h.acikPluginler()).toEqual(['sl-ban-enforcer']);
  });
});

describe('seed-tracker', () => {
  const cfg = (config: Record<string, unknown> = {}) => ({
    pluginName: 'seed-tracker',
    enabled: true,
    config: { minSessionSeconds: 0, checkIntervalSeconds: 30, ...config },
  });

  /** Emit edilen olayları toplayan host. */
  function seedHost(e: SahteEngine, admins: AdminIdentity[] = []) {
    const olaylar: AgentEvent[] = [];
    const h = new PluginHost({
      serverSlug: 'squad-01',
      engine: e,
      emit: (ev) => olaylar.push(ev),
    });
    if (admins.length > 0) h.adminListesiniGuncelle(admins);
    h.register(seedTracker);
    return { h, olaylar };
  }

  const oyuncu = (over: Partial<SquadJSOnlinePlayer> = {}): SquadJSOnlinePlayer =>
    ({
      steamId: '76561190000000001',
      eosId: 'abcdef01234567890abcdef012345678',
      name: 'Ali',
      teamId: 1,
      squadId: 1,
      isLeader: false,
      role: 'USA_Rifleman_01',
      ...over,
    }) as SquadJSOnlinePlayer;

  const seedOlaylari = (olaylar: AgentEvent[]) =>
    olaylar.filter((o) => o.type === 'SEED_SESSION') as Extract<
      AgentEvent,
      { type: 'SEED_SESSION' }
    >[];

  it('seed haritasında geçen süreyi gamemode sebebiyle yazar', async () => {
    const e = sahteEngine();
    e.layer = 'Sumari_Seed_v1';
    e.oyuncular.push(oyuncu());
    const { h, olaylar } = seedHost(e);
    await h.applyConfigs([cfg()]);

    await vi.advanceTimersByTimeAsync(30_000); // takip başlar
    await vi.advanceTimersByTimeAsync(60_000); // sürer
    e.oyuncular.length = 0;
    await vi.advanceTimersByTimeAsync(30_000); // hayalet temizliği kapatır

    const s = seedOlaylari(olaylar);
    expect(s).toHaveLength(1);
    expect(s[0]?.seedReason).toBe('gamemode');
    expect(s[0]?.durationSeconds).toBeGreaterThanOrEqual(60);
  });

  it('sunucu az doluysa seed sayılır ama sebebi player_count olur', async () => {
    // Ayrım şart: admin nöbeti YALNIZCA seed haritasını sayıyordu,
    // haftalık ödül ise az dolu sunucuyu da sayıyordu.
    const e = sahteEngine();
    e.layer = 'Narva_RAAS_v1';
    e.oyuncular.push(oyuncu());
    const { h, olaylar } = seedHost(e);
    await h.applyConfigs([cfg({ playerCountThreshold: 50 })]);

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(60_000);
    e.oyuncular.length = 0;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(seedOlaylari(olaylar)[0]?.seedReason).toBe('player_count');
  });

  it('sunucu BOŞKEN kimse süre biriktirmez', async () => {
    // Kimsenin olmadığı sunucuda "doldurma" diye bir şey yok; aksi hâlde
    // sunucu kapalıyken herkes süre kazanırdı.
    const e = sahteEngine();
    e.layer = 'Narva_RAAS_v1';
    const { h, olaylar } = seedHost(e);
    await h.applyConfigs([cfg({ playerCountThreshold: 50 })]);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(seedOlaylari(olaylar)).toEqual([]);
  });

  it('sunucu dolunca (canlı) takip kapanır ve süre yazılır', async () => {
    const e = sahteEngine();
    e.layer = 'Narva_RAAS_v1';
    e.oyuncular.push(oyuncu());
    const { h, olaylar } = seedHost(e);
    await h.applyConfigs([cfg({ playerCountThreshold: 2 })]);

    await vi.advanceTimersByTimeAsync(30_000);
    // Sunucu doldu: eşiğin üstüne çık.
    e.oyuncular.push(oyuncu({ steamId: '76561190000000002', eosId: null, name: 'Veli' }));
    e.oyuncular.push(oyuncu({ steamId: '76561190000000003', eosId: null, name: 'Ayse' }));
    await vi.advanceTimersByTimeAsync(30_000);

    expect(seedOlaylari(olaylar)).toHaveLength(1);
  });

  it('admin yetkisi kayda wasAdmin olarak geçer', async () => {
    const e = sahteEngine();
    e.layer = 'Sumari_Seed_v1';
    e.oyuncular.push(oyuncu());
    const { h, olaylar } = seedHost(e, [
      { steamId: '76561190000000001', groupName: 'Admin', permissions: 'kick,ban' },
    ]);
    await h.applyConfigs([cfg()]);

    await vi.advanceTimersByTimeAsync(30_000);
    e.oyuncular.length = 0;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(seedOlaylari(olaylar)[0]?.wasAdmin).toBe(true);
  });

  it('YALNIZCA reserve yetkisi olan admin SAYILMAZ', async () => {
    // Bağışçı/klan whitelist'i admin değil; nöbet raporuna girmemeli.
    const e = sahteEngine();
    e.layer = 'Sumari_Seed_v1';
    e.oyuncular.push(oyuncu());
    const { h, olaylar } = seedHost(e, [
      { steamId: '76561190000000001', groupName: 'BagisWL', permissions: 'reserve' },
    ]);
    await h.applyConfigs([cfg()]);

    await vi.advanceTimersByTimeAsync(30_000);
    e.oyuncular.length = 0;
    await vi.advanceTimersByTimeAsync(30_000);

    expect(seedOlaylari(olaylar)[0]?.wasAdmin).toBe(false);
  });

  it('kısa aralıklar gönderilmez', async () => {
    // Harita geçişlerinde oyuncular saniyeler içinde düşüp geliyor; bu
    // gürültü tabloyu anlamsız satırlarla dolduruyordu.
    const e = sahteEngine();
    e.layer = 'Sumari_Seed_v1';
    e.oyuncular.push(oyuncu());
    const { h, olaylar } = seedHost(e);
    await h.applyConfigs([cfg({ minSessionSeconds: 60, checkIntervalSeconds: 10 })]);

    await vi.advanceTimersByTimeAsync(10_000);
    e.oyuncular.length = 0;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(seedOlaylari(olaylar)).toEqual([]);
  });

  it('round bitince aralık KAPANIR — canlı maça taşınmaz', async () => {
    const e = sahteEngine();
    e.layer = 'Sumari_Seed_v1';
    e.oyuncular.push(oyuncu());
    const { h, olaylar } = seedHost(e);
    await h.applyConfigs([cfg()]);

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await h.handleEvent({
      type: 'ROUND_ENDED',
      serverSlug: 'squad-01',
      timestamp: new Date().toISOString(),
    });

    expect(seedOlaylari(olaylar)).toHaveLength(1);
  });

  it('uzun oturum checkpoint ile parçalanır', async () => {
    // Agent çökerse yalnızca son parça kaybolsun.
    const e = sahteEngine();
    e.layer = 'Sumari_Seed_v1';
    e.oyuncular.push(oyuncu());
    const { h, olaylar } = seedHost(e);
    await h.applyConfigs([cfg({ checkpointMinutes: 5, checkIntervalSeconds: 30 })]);

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(11 * 60_000);

    expect(seedOlaylari(olaylar).length).toBeGreaterThanOrEqual(2);
  });

  it('plugin kapanınca biriken süre KAYBOLMAZ', async () => {
    const e = sahteEngine();
    e.layer = 'Sumari_Seed_v1';
    e.oyuncular.push(oyuncu());
    const { h, olaylar } = seedHost(e);
    await h.applyConfigs([cfg()]);

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await h.applyConfigs([]);

    expect(seedOlaylari(olaylar)).toHaveLength(1);
  });

  it('EOS ile takip edilen oyuncunun ayrılışı SteamID olayıyla yakalanır', async () => {
    // PLAYER_DISCONNECTED yalnızca SteamID taşıyor; anahtarı doğrudan
    // aramak EOS ile takip edilen oyuncuyu kaçırırdı.
    const e = sahteEngine();
    e.layer = 'Sumari_Seed_v1';
    e.oyuncular.push(oyuncu());
    const { h, olaylar } = seedHost(e);
    await h.applyConfigs([cfg()]);

    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(60_000);
    await h.handleEvent({
      type: 'PLAYER_DISCONNECTED',
      serverSlug: 'squad-01',
      steamId: '76561190000000001',
      timestamp: new Date().toISOString(),
    });

    expect(seedOlaylari(olaylar)).toHaveLength(1);
  });
});

describe('seeding-mode', () => {
  const cfg = (config: Record<string, unknown> = {}) => ({
    pluginName: 'seeding-mode',
    enabled: true,
    config: { intervalSeconds: 30, ...config },
  });

  it('eşiğin altında seed kuralları duyurulur', async () => {
    const e = sahteEngine();
    e.oyuncular.push({} as SquadJSOnlinePlayer);
    const h = host(e);
    h.register(seedingMode);
    await h.applyConfigs([cfg({ seedingThreshold: 50, seedingMessage: 'Seed kurallari' })]);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(e.komutlar).toEqual(['AdminBroadcast Seed kurallari']);
  });

  it('sunucu BOŞKEN duyuru yapılmaz', async () => {
    const e = sahteEngine();
    const h = host(e);
    h.register(seedingMode);
    await h.applyConfigs([cfg()]);

    await vi.advanceTimersByTimeAsync(120_000);
    expect(e.komutlar).toEqual([]);
  });

  it('yeni harita sonrası kısa süre sessiz kalır', async () => {
    // Harita geçişinin hemen ardından oyuncu sayısı oturmamış oluyor;
    // dolu sunucuda "seed kuralları" duyurmak yanlış mesaj demekti.
    const e = sahteEngine();
    e.oyuncular.push({} as SquadJSOnlinePlayer);
    const h = host(e);
    h.register(seedingMode);
    await h.applyConfigs([cfg({ newGameQuietSeconds: 60 })]);

    await h.handleEvent({
      type: 'ROUND_STARTED',
      serverSlug: 'squad-01',
      timestamp: new Date().toISOString(),
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(e.komutlar).toEqual([]);

    // Sessizlik 60. saniyede bitiyor; bir sonraki tur duyuruyu yapmalı.
    await vi.advanceTimersByTimeAsync(31_000);
    expect(e.komutlar).toHaveLength(1);
  });
});

describe('auto-seed-scheduler', () => {
  const cfg = (config: Record<string, unknown> = {}) => ({
    pluginName: 'auto-seed-scheduler',
    enabled: true,
    config: { roundEndDelaySeconds: 0, ...config },
  });

  it('round sonunda sunucu boşsa seed haritasına geçer', async () => {
    const e = sahteEngine();
    e.layer = 'Narva_RAAS_v1';
    const h = host(e);
    h.register(autoSeedScheduler);
    await h.applyConfigs([cfg({ roundEndPlayerThreshold: 25, layer: 'Sumari_Seed_v1' })]);

    await h.handleEvent({
      type: 'ROUND_ENDED',
      serverSlug: 'squad-01',
      timestamp: new Date().toISOString(),
    });
    expect(e.komutlar).toEqual(['AdminChangeLayer Sumari_Seed_v1']);
  });

  it('sunucu doluysa round sonunda geçiş YAPILMAZ', async () => {
    const e = sahteEngine();
    e.layer = 'Narva_RAAS_v1';
    for (let i = 0; i < 30; i++) e.oyuncular.push({} as SquadJSOnlinePlayer);
    const h = host(e);
    h.register(autoSeedScheduler);
    await h.applyConfigs([cfg({ roundEndPlayerThreshold: 25 })]);

    await h.handleEvent({
      type: 'ROUND_ENDED',
      serverSlug: 'squad-01',
      timestamp: new Date().toISOString(),
    });
    expect(e.komutlar).toEqual([]);
  });

  it('zaten seed haritasındaysa geçiş yapılmaz', async () => {
    const e = sahteEngine();
    e.layer = 'Sumari_Seed_v1';
    const h = host(e);
    h.register(autoSeedScheduler);
    await h.applyConfigs([cfg()]);

    await h.handleEvent({
      type: 'ROUND_ENDED',
      serverSlug: 'squad-01',
      timestamp: new Date().toISOString(),
    });
    expect(e.komutlar).toEqual([]);
  });

  it('harita adında boşluk varsa komut GÖNDERİLMEZ', async () => {
    // Ayar panelden geliyor; boşluklu bir değer RCON komutunu ikiye böler.
    const e = sahteEngine();
    e.layer = 'Narva_RAAS_v1';
    const h = host(e);
    h.register(autoSeedScheduler);
    await h.applyConfigs([cfg({ layer: 'Sumari Seed v1' })]);

    await h.handleEvent({
      type: 'ROUND_ENDED',
      serverSlug: 'squad-01',
      timestamp: new Date().toISOString(),
    });
    expect(e.komutlar).toEqual([]);
  });
});

describe('steam-level', () => {
  const cfg = (config: Record<string, unknown> = {}) => ({
    pluginName: 'steam-level',
    enabled: true,
    config: { delaySeconds: 0, ...config },
  });

  /** Steam API'yi ve tazelik sorgusunu sahteleyen host. */
  function kur(
    steamCevabi: unknown,
    tazelik: { bulundu: boolean; taze: boolean } | null = { bulundu: false, taze: false },
    /** GetPlayerSummaries cevabı — yalnızca seviye gelmediğinde sorulur. */
    ozetCevabi?: unknown,
  ) {
    const e = sahteEngine();
    const olaylar: AgentEvent[] = [];
    const sorgular: AgentQuery[] = [];
    const h = new PluginHost({
      serverSlug: 'squad-01',
      engine: e,
      emit: (ev) => olaylar.push(ev),
      secrets: { steamApiKey: 'TEST_KEY' },
      sorgu: async (q) => {
        sorgular.push(q);
        return tazelik;
      },
    });
    h.register(steamLevel);
    vi.stubGlobal('fetch', async (url: string) =>
      String(url).includes('GetPlayerSummaries') ? ozetCevabi : steamCevabi,
    );
    return { h, olaylar, sorgular };
  }

  /** communityvisibilitystate: 3 = açık, 1 = gizli. */
  const ozet = (gorunurluk: number) =>
    cevap({ response: { players: [{ communityvisibilitystate: gorunurluk }] } });

  const seviyeOlaylari = (olaylar: AgentEvent[]) =>
    olaylar.filter((o) => o.type === 'STEAM_LEVEL') as Extract<
      AgentEvent,
      { type: 'STEAM_LEVEL' }
    >[];

  const cevap = (body: unknown, ok = true) => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  });

  it('okunan seviyeyi bildirir', async () => {
    const { h, olaylar } = kur(cevap({ response: { player_level: 2 } }));
    await h.applyConfigs([cfg()]);
    await h.handleEvent(baglandi('Ali'));

    const s = seviyeOlaylari(olaylar);
    expect(s).toHaveLength(1);
    expect(s[0]?.level).toBe(2);
    expect(s[0]?.private).toBe(false);
    expect(s[0]?.steamId).toBe('76561190000000001');
  });

  it('seviye 0 da geçerli bir cevaptır', async () => {
    // Gerçekten seviye 0 olan hesaplar var; bunu "okunamadı" saymak
    // en düşük seviyeli hesapları etiketsiz bırakırdı.
    const { h, olaylar } = kur(cevap({ response: { player_level: 0 } }));
    await h.applyConfigs([cfg()]);
    await h.handleEvent(baglandi('Ali'));

    expect(seviyeOlaylari(olaylar)[0]?.level).toBe(0);
  });

  it('gizli profil "seviye 0" DEĞİL, level null gider', async () => {
    // En kritik ayrım. Gizlilik TAHMİN EDİLMİYOR: seviye gelmediğinde
    // Steam'e görünürlük ayrıca soruluyor (communityvisibilitystate).
    const { h, olaylar } = kur(cevap({ response: {} }), undefined, ozet(1));
    await h.applyConfigs([cfg()]);
    await h.handleEvent(baglandi('Ali'));

    const s = seviyeOlaylari(olaylar);
    expect(s).toHaveLength(1);
    expect(s[0]?.level).toBeNull();
    expect(s[0]?.private).toBe(true);
  });

  it('Steam ulaşılamazsa hiçbir şey bildirilmez', async () => {
    // "Okunamadı" kaydı yazmak bir sonraki denemeyi de gereksizce erteler.
    const { h, olaylar } = kur(cevap({}, false));
    await h.applyConfigs([cfg()]);
    await h.handleEvent(baglandi('Ali'));

    expect(seviyeOlaylari(olaylar)).toEqual([]);
  });

  it('ağ hatası plugin’i düşürmez', async () => {
    const e = sahteEngine();
    const olaylar: AgentEvent[] = [];
    const h = new PluginHost({
      serverSlug: 'squad-01',
      engine: e,
      emit: (ev) => olaylar.push(ev),
      secrets: { steamApiKey: 'TEST_KEY' },
      sorgu: async () => ({ bulundu: false, taze: false }),
    });
    h.register(steamLevel);
    vi.stubGlobal('fetch', async () => {
      throw new Error('ağ hatası');
    });
    await h.applyConfigs([cfg()]);
    await h.handleEvent(baglandi('Ali'));

    expect(seviyeOlaylari(olaylar)).toEqual([]);
    expect(h.acikPluginler()).toEqual(['steam-level']);
  });

  it('api’de TAZE kayıt varsa Steam’e hiç gidilmez', async () => {
    // Steam kotasını korumanın tek yolu bu; seviye yavaş değişen bir veri.
    let istekSayisi = 0;
    const e = sahteEngine();
    const olaylar: AgentEvent[] = [];
    const h = new PluginHost({
      serverSlug: 'squad-01',
      engine: e,
      emit: (ev) => olaylar.push(ev),
      secrets: { steamApiKey: 'TEST_KEY' },
      sorgu: async () => ({ bulundu: true, taze: true }),
    });
    h.register(steamLevel);
    vi.stubGlobal('fetch', async () => {
      istekSayisi++;
      return cevap({ response: { player_level: 2 } });
    });
    await h.applyConfigs([cfg()]);
    await h.handleEvent(baglandi('Ali'));

    expect(istekSayisi).toBe(0);
    expect(seviyeOlaylari(olaylar)).toEqual([]);
  });

  it('tazelik sorgusu cevapsızsa (null) yine de OKUNUR', async () => {
    // Bir dış sorgunun başarısızlığı yüzünden veri hiç toplanmamalı;
    // birkaç fazla Steam isteği bundan ucuz.
    const { h, olaylar } = kur(cevap({ response: { player_level: 1 } }), null);
    await h.applyConfigs([cfg()]);
    await h.handleEvent(baglandi('Ali'));

    expect(seviyeOlaylari(olaylar)).toHaveLength(1);
  });

  it('tazelik sorgusu plugin ayarındaki eşikleri taşır', async () => {
    const { h, sorgular } = kur(cevap({ response: { player_level: 1 } }));
    await h.applyConfigs([cfg({ recheckDays: 45, privateRecheckDays: 3 })]);
    await h.handleEvent(baglandi('Ali'));

    expect(sorgular[0]).toEqual({
      kind: 'steam_level_freshness',
      steamId: '76561190000000001',
      maxAgeDays: 45,
      privateMaxAgeDays: 3,
    });
  });

  it('SteamID’si olmayan oyuncu için istek atılmaz', async () => {
    const { h, sorgular } = kur(cevap({ response: { player_level: 1 } }));
    await h.applyConfigs([cfg()]);
    await h.handleEvent({
      type: 'PLAYER_CONNECTED',
      serverSlug: 'squad-01',
      steamId: '',
      name: 'Kimliksiz',
      timestamp: new Date().toISOString(),
    });

    expect(sorgular).toEqual([]);
  });
});

describe('steam-level — gizlilik tahmin edilmiyor', () => {
  const cfg = { pluginName: 'steam-level', enabled: true, config: { delaySeconds: 0 } };

  function kurGorunurluk(seviyeCevabi: unknown, ozetCevabi: unknown) {
    const e = sahteEngine();
    const olaylar: AgentEvent[] = [];
    const istekler: string[] = [];
    const h = new PluginHost({
      serverSlug: 'squad-01',
      engine: e,
      emit: (ev) => olaylar.push(ev),
      secrets: { steamApiKey: 'TEST_KEY' },
      sorgu: async () => ({ bulundu: false, taze: false }),
    });
    h.register(steamLevel);
    vi.stubGlobal('fetch', async (url: string) => {
      istekler.push(String(url));
      return String(url).includes('GetPlayerSummaries') ? ozetCevabi : seviyeCevabi;
    });
    return { h, olaylar, istekler };
  }

  const yanit = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  const seviyeOlaylari = (o: AgentEvent[]) =>
    o.filter((x) => x.type === 'STEAM_LEVEL') as Extract<AgentEvent, { type: 'STEAM_LEVEL' }>[];

  it('seviye geldiyse görünürlük SORULMAZ', async () => {
    // Ek istek yalnızca gerektiğinde atılmalı; her girişte iki çağrı
    // Steam kotasını iki katına çıkarırdı.
    const { h, olaylar, istekler } = kurGorunurluk(
      yanit({ response: { player_level: 7 } }),
      yanit({}),
    );
    await h.applyConfigs([cfg]);
    await h.handleEvent(baglandi('Ali'));

    expect(seviyeOlaylari(olaylar)[0]?.level).toBe(7);
    expect(istekler.some((u) => u.includes('GetPlayerSummaries'))).toBe(false);
  });

  it('seviye yok + profil GİZLİ -> private, seviye null', async () => {
    const { h, olaylar } = kurGorunurluk(
      yanit({ response: {} }),
      yanit({ response: { players: [{ communityvisibilitystate: 1 }] } }),
    );
    await h.applyConfigs([cfg]);
    await h.handleEvent(baglandi('Ali'));

    const s = seviyeOlaylari(olaylar);
    expect(s).toHaveLength(1);
    expect(s[0]?.level).toBeNull();
    expect(s[0]?.private).toBe(true);
  });

  it('seviye yok ama profil AÇIK -> hiçbir şey bildirilmez', async () => {
    // Beklenmedik durum. "Gizli" diye kaydetmek yanlış olurdu: bir sonraki
    // deneme gizli profil takvimine göre ertelenirdi.
    const { h, olaylar } = kurGorunurluk(
      yanit({ response: {} }),
      yanit({ response: { players: [{ communityvisibilitystate: 3 }] } }),
    );
    await h.applyConfigs([cfg]);
    await h.handleEvent(baglandi('Ali'));

    expect(seviyeOlaylari(olaylar)).toEqual([]);
  });

  it('görünürlük de okunamazsa hiçbir şey bildirilmez', async () => {
    const { h, olaylar } = kurGorunurluk(yanit({ response: {} }), { ok: false, status: 500 });
    await h.applyConfigs([cfg]);
    await h.handleEvent(baglandi('Ali'));

    expect(seviyeOlaylari(olaylar)).toEqual([]);
  });

  it('seviye 0 gerçek bir cevaptır — görünürlük sorulmaz', async () => {
    // Steam gizli profil için 0 dönseydi bile bu yol etkilenmez: 0 sayı
    // olduğu için doğrudan seviye kabul edilir. Gizliliği ayrı sormanın
    // sebebi tam olarak bu belirsizliği ortadan kaldırmaktı.
    const { h, olaylar, istekler } = kurGorunurluk(
      yanit({ response: { player_level: 0 } }),
      yanit({}),
    );
    await h.applyConfigs([cfg]);
    await h.handleEvent(baglandi('Ali'));

    expect(seviyeOlaylari(olaylar)[0]?.level).toBe(0);
    expect(istekler.some((u) => u.includes('GetPlayerSummaries'))).toBe(false);
  });
});

const komutMesaji = (
  message: string,
  channel: 'All' | 'Team' | 'Squad' | 'Admin' = 'All',
  steamId = '76561190000000001',
): AgentEvent => ({
  type: 'CHAT_MESSAGE',
  serverSlug: 'squad-01',
  steamId,
  channel,
  message,
  timestamp: new Date().toISOString(),
});

describe('chat-commands', () => {
  const kur = async (e: SahteEngine, commands: unknown[], admins: AdminIdentity[] = []) => {
    const h = host(e, admins);
    h.register(chatCommands);
    await h.applyConfigs([{ pluginName: 'chat-commands', enabled: true, config: { commands } }]);
    return h;
  };

  it('warn tipi komut yalnızca çağırana gider', async () => {
    const e = sahteEngine();
    const h = await kur(e, [{ command: 'discord', type: 'warn', response: 'discord.gg/altai' }]);
    await h.handleEvent(komutMesaji('!discord'));
    expect(e.komutlar).toEqual(['AdminWarn 76561190000000001 discord.gg/altai']);
  });

  it('broadcast tipi komut herkese gider', async () => {
    const e = sahteEngine();
    const h = await kur(e, [{ command: 'kural', type: 'broadcast', response: 'Kurallar geçerli' }]);
    await h.handleEvent(komutMesaji('!kural'));
    expect(e.komutlar).toEqual(['AdminBroadcast Kurallar geçerli']);
  });

  it('tanımsız komut hiçbir şey yapmaz', async () => {
    const e = sahteEngine();
    const h = await kur(e, [{ command: 'discord', type: 'warn', response: 'x' }]);
    await h.handleEvent(komutMesaji('!baskabirsey'));
    expect(e.komutlar).toEqual([]);
  });

  it('kanal kısıtı uygulanır', async () => {
    const e = sahteEngine();
    const h = await kur(e, [
      { command: 'gizli', type: 'warn', response: 'x', channels: ['Admin'] },
    ]);
    await h.handleEvent(komutMesaji('!gizli', 'All'));
    expect(e.komutlar).toEqual([]);

    await h.handleEvent(komutMesaji('!gizli', 'Admin'));
    expect(e.komutlar).toHaveLength(1);
  });

  it('adminOnly komutu yetkisiz oyuncuda çalışmaz', async () => {
    // Kanal yetki değildir; ikisi ayrı kontrol.
    const e = sahteEngine();
    const h = await kur(e, [{ command: 'yonetim', type: 'warn', response: 'x', adminOnly: true }]);
    await h.handleEvent(komutMesaji('!yonetim'));
    expect(e.komutlar).toEqual([]);
  });

  it('adminOnly komutu gerçek adminde çalışır', async () => {
    const e = sahteEngine();
    const h = await kur(
      e,
      [{ command: 'yonetim', type: 'warn', response: 'x', adminOnly: true }],
      [{ steamId: '76561190000000001', groupName: 'Admin', permissions: 'kick,ban' }],
    );
    await h.handleEvent(komutMesaji('!yonetim'));
    expect(e.komutlar).toHaveLength(1);
  });
});

describe('team-randomizer', () => {
  const admin: AdminIdentity[] = [
    { steamId: '76561190000000001', groupName: 'Admin', permissions: 'kick,ban,forceteamchange' },
  ];

  function oyuncular(e: SahteEngine, adet: number, lider = 0) {
    for (let i = 0; i < adet; i++) {
      e.oyuncular.push({
        steamId: `7656119000000${String(i).padStart(4, '0')}`,
        eosId: null,
        name: `O${i}`,
        teamId: 1,
        squadId: 1,
        isLeader: i < lider,
        role: 'USA_Rifleman_01',
      } as SquadJSOnlinePlayer);
    }
  }

  const kur = async (e: SahteEngine, config: Record<string, unknown> = {}, admins = admin) => {
    const h = host(e, admins);
    h.register(teamRandomizer);
    await h.applyConfigs([
      {
        pluginName: 'team-randomizer',
        enabled: true,
        config: { commandDelayMs: 0, announceMessage: 'Karıştırıldı', ...config },
      },
    ]);
    return h;
  };

  it('admin komutu takımları dağıtır', async () => {
    const e = sahteEngine();
    oyuncular(e, 6);
    const h = await kur(e);
    await h.handleEvent(komutMesaji('!randomize', 'Admin'));

    // Hepsi teamId=1'de; yarısı 2'ye geçmeli.
    const gecisler = e.komutlar.filter((c) => c.startsWith('AdminForceTeamChange'));
    expect(gecisler).toHaveLength(3);
    expect(e.komutlar.at(-1)).toBe('AdminBroadcast Karıştırıldı');
  });

  it('YETKİSİZ oyuncu admin kanalından yazsa bile çalışmaz', async () => {
    // Eski plugin'in tek kontrolü kanaldı: admin sohbetini görebilen ama
    // yetkisi olmayan biri bütün sunucunun takımını değiştirebiliyordu.
    const e = sahteEngine();
    oyuncular(e, 6);
    const h = await kur(e, {}, []);
    await h.handleEvent(komutMesaji('!randomize', 'Admin'));
    expect(e.komutlar).toEqual([]);
  });

  it('manga liderleri varsayılan olarak KORUNUR', async () => {
    // Eski plugin liderleri de karıştırıyor, mangalar maç başında
    // dağılıyordu.
    const e = sahteEngine();
    oyuncular(e, 6, 2); // ilk ikisi lider
    const h = await kur(e);
    await h.handleEvent(komutMesaji('!randomize', 'Admin'));

    const gecisler = e.komutlar.filter((c) => c.startsWith('AdminForceTeamChange'));
    expect(gecisler).toHaveLength(2); // 4 oyuncudan 2'si
    expect(gecisler.some((c) => c.includes('0000000000'))).toBe(false);
  });

  it('az oyuncu varken çalışmaz', async () => {
    const e = sahteEngine();
    oyuncular(e, 2);
    const h = await kur(e, { minPlayers: 4 });
    await h.handleEvent(komutMesaji('!randomize', 'Admin'));
    expect(e.komutlar).toEqual([]);
  });

  it('izin verilmeyen kanaldan çalışmaz', async () => {
    const e = sahteEngine();
    oyuncular(e, 6);
    const h = await kur(e);
    await h.handleEvent(komutMesaji('!randomize', 'All'));
    expect(e.komutlar).toEqual([]);
  });
});

describe('squad-join-request', () => {
  function sahne(e: SahteEngine) {
    e.oyuncular.push(
      {
        steamId: '76561190000000001',
        eosId: null,
        name: 'Isteyen',
        teamId: 1,
        squadId: null,
        isLeader: false,
        role: 'r',
      } as SquadJSOnlinePlayer,
      {
        steamId: '76561190000000002',
        eosId: 'aaaaaaaa1234567890abcdef01234567',
        name: 'Lider',
        teamId: 1,
        squadId: 3,
        isLeader: true,
        role: 'sl',
      } as SquadJSOnlinePlayer,
      {
        steamId: '76561190000000003',
        eosId: null,
        name: 'KarsiLider',
        teamId: 2,
        squadId: 3,
        isLeader: true,
        role: 'sl',
      } as SquadJSOnlinePlayer,
    );
  }

  const kur = async (e: SahteEngine, config: Record<string, unknown> = {}) => {
    const h = host(e);
    h.register(squadJoinRequest);
    await h.applyConfigs([
      {
        pluginName: 'squad-join-request',
        enabled: true,
        config: { cooldownSeconds: 0, ...config },
      },
    ]);
    return h;
  };

  it('istek lidere ve isteyene bildirilir', async () => {
    const e = sahteEngine();
    sahne(e);
    const h = await kur(e);
    await h.handleEvent(komutMesaji('!katıl 3'));

    expect(e.komutlar).toEqual([
      'AdminWarn aaaaaaaa1234567890abcdef01234567 Isteyen manganıza katılmak istiyor.',
      'AdminWarn 76561190000000001 İstek manga 3 liderine iletildi.',
    ]);
  });

  it('KARŞI takımın mangasına istek gitmez', async () => {
    // Aynı numaralı manga her iki takımda da var; takım kontrolü olmadan
    // istek rakip takımın liderine giderdi.
    const e = sahteEngine();
    sahne(e);
    const lider = e.oyuncular[1];
    if (lider) lider.teamId = 2; // aynı takımda lider kalmasın
    const h = await kur(e);
    await h.handleEvent(komutMesaji('!katıl 3'));

    expect(e.komutlar).toEqual([
      'AdminWarn 76561190000000001 Manga 3 bulunamadı ya da lideri yok.',
    ]);
  });

  it('tek mesajdaki manga sayısı SINIRLI', async () => {
    // Sınırsızken tek mesajla sunucudaki her lidere uyarı gönderilebiliyordu.
    const e = sahteEngine();
    sahne(e);
    const h = await kur(e, { maxSquadsPerRequest: 2 });
    await h.handleEvent(komutMesaji('!katıl 1,2,3,4,5,6,7,8'));

    // 2 mangaya bakıldı, ikisi de bulunamadı (yalnızca 3 numaralı var).
    expect(e.komutlar).toHaveLength(2);
  });

  it('tekrarlanan numara bir kez sayılır', async () => {
    const e = sahteEngine();
    sahne(e);
    const h = await kur(e);
    await h.handleEvent(komutMesaji('!katıl 3,3,3'));
    expect(e.komutlar).toHaveLength(2); // lidere 1 + isteyene 1
  });

  it('bekleme süresi içinde ikinci istek reddedilir', async () => {
    const e = sahteEngine();
    sahne(e);
    const h = await kur(e, { cooldownSeconds: 30 });
    await h.handleEvent(komutMesaji('!katıl 3'));
    e.komutlar.length = 0;

    await h.handleEvent(komutMesaji('!katıl 3'));
    expect(e.komutlar).toHaveLength(1);
    expect(e.komutlar[0]).toContain('Çok sık istek');
  });

  it('geçersiz argüman kullanım mesajı döndürür', async () => {
    const e = sahteEngine();
    sahne(e);
    const h = await kur(e);
    await h.handleEvent(komutMesaji('!katıl abc'));
    expect(e.komutlar[0]).toContain('Kullanım:');
  });
});

describe('fog-of-war', () => {
  const kidemli: AdminIdentity[] = [
    { steamId: '76561190000000001', groupName: 'SuperAdmin', permissions: 'kick,ban,changemap' },
  ];
  const siradan: AdminIdentity[] = [
    { steamId: '76561190000000001', groupName: 'Admin', permissions: 'kick,ban' },
  ];

  const kur = async (e: SahteEngine, admins: AdminIdentity[]) => {
    const h = host(e, admins);
    h.register(fogOfWar);
    await h.applyConfigs([{ pluginName: 'fog-of-war', enabled: true, config: {} }]);
    return h;
  };

  it('kıdemli admin açıp kapatabilir', async () => {
    const e = sahteEngine();
    const h = await kur(e, kidemli);

    await h.handleEvent(komutMesaji('!fow', 'Admin'));
    expect(e.komutlar).toEqual(['AdminSetFogOfWar 1', 'AdminBroadcast Sis savaşı açıldı!']);

    e.komutlar.length = 0;
    await h.handleEvent(komutMesaji('!fow', 'Admin'));
    expect(e.komutlar).toEqual(['AdminSetFogOfWar 0', 'AdminBroadcast Sis savaşı kapatıldı!']);
  });

  it('SIRADAN admin kullanamaz', async () => {
    // `kick` yetkisi olan herkesin haritayı karartabilmesi istenmiyor.
    const e = sahteEngine();
    const h = await kur(e, siradan);
    await h.handleEvent(komutMesaji('!fow', 'Admin'));

    expect(e.komutlar.some((c) => c.startsWith('AdminSetFogOfWar'))).toBe(false);
    expect(e.komutlar[0]).toContain('yetkin yok');
  });

  it('yetki listesi hiç gelmediyse reddedilir', async () => {
    const e = sahteEngine();
    const h = await kur(e, []);
    await h.handleEvent(komutMesaji('!fow', 'Admin'));
    expect(e.komutlar.some((c) => c.startsWith('AdminSetFogOfWar'))).toBe(false);
  });

  it('yeni maçta RCON komutu GÖNDERİLMEZ, sadece yön sıfırlanır', async () => {
    // Sunucu sis savaşını maç başında kendi sıfırlıyor; plugin'in ayrıca
    // komut göndermesi, kimsenin istemediği bir anda ayarı değiştirirdi.
    const e = sahteEngine();
    const h = await kur(e, kidemli);
    await h.handleEvent(komutMesaji('!fow', 'Admin')); // açıldı
    e.komutlar.length = 0;

    await h.handleEvent({
      type: 'ROUND_STARTED',
      serverSlug: 'squad-01',
      timestamp: new Date().toISOString(),
    });
    expect(e.komutlar).toEqual([]);

    // Yön sıfırlandığı için bir sonraki komut yine AÇMALI.
    await h.handleEvent(komutMesaji('!fow', 'Admin'));
    expect(e.komutlar[0]).toBe('AdminSetFogOfWar 1');
  });
});

describe('cbl-info', () => {
  const yanit = (body: unknown, ok = true) => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  });

  const cblCevabi = (over: Record<string, unknown> = {}) =>
    yanit({
      data: {
        steamUser: {
          name: 'Sorunlu',
          avatarFull: 'https://x/y.png',
          reputationPoints: 12,
          riskRating: 7,
          reputationRank: 42,
          activeBans: { edges: [{ node: { id: '1' } }, { node: { id: '2' } }] },
          expiredBans: { edges: [{ node: { id: '3' } }] },
          ...over,
        },
      },
    });

  function kur(fetchCevabi: unknown) {
    const e = sahteEngine();
    const olaylar: AgentEvent[] = [];
    const h = new PluginHost({ serverSlug: 'squad-01', engine: e, emit: (ev) => olaylar.push(ev) });
    h.register(cblInfo);
    vi.stubGlobal('fetch', async () => fetchCevabi);
    return { h, e, olaylar };
  }

  const cfg = (config: Record<string, unknown> = {}) => ({
    pluginName: 'cbl-info',
    enabled: true,
    config: { delaySeconds: 0, ...config },
  });

  const uyarilar = (o: AgentEvent[]) =>
    o.filter((x) => x.type === 'CBL_ALERT') as Extract<AgentEvent, { type: 'CBL_ALERT' }>[];

  it('eşiği aşan oyuncu için uyarı üretir', async () => {
    const { h, olaylar } = kur(cblCevabi());
    await h.applyConfigs([cfg({ threshold: 6 })]);
    await h.handleEvent(baglandi('Sorunlu'));

    const u = uyarilar(olaylar);
    expect(u).toHaveLength(1);
    expect(u[0]?.reputationPoints).toBe(12);
    expect(u[0]?.activeBans).toBe(2);
    expect(u[0]?.expiredBans).toBe(1);
    expect(u[0]?.riskRating).toBe(7);
  });

  it('eşiğin ALTINDA uyarı üretilmez', async () => {
    const { h, olaylar } = kur(cblCevabi({ reputationPoints: 3 }));
    await h.applyConfigs([cfg({ threshold: 6 })]);
    await h.handleEvent(baglandi('Temiz'));
    expect(uyarilar(olaylar)).toEqual([]);
  });

  it('CBL listesinde olmayan oyuncu için uyarı yok', async () => {
    const { h, olaylar } = kur(yanit({ data: { steamUser: null } }));
    await h.applyConfigs([cfg()]);
    await h.handleEvent(baglandi('Bilinmeyen'));
    expect(uyarilar(olaylar)).toEqual([]);
  });

  it('CBL ulaşılamazsa uyarı üretilmez ve plugin ayakta kalır', async () => {
    const { h, olaylar } = kur(yanit({}, false));
    await h.applyConfigs([cfg()]);
    await h.handleEvent(baglandi('X'));
    expect(uyarilar(olaylar)).toEqual([]);
    expect(h.acikPluginler()).toEqual(['cbl-info']);
  });

  it('ağ hatası plugin’i düşürmez', async () => {
    const e = sahteEngine();
    const olaylar: AgentEvent[] = [];
    const h = new PluginHost({ serverSlug: 'squad-01', engine: e, emit: (ev) => olaylar.push(ev) });
    h.register(cblInfo);
    vi.stubGlobal('fetch', async () => {
      throw new Error('ağ');
    });
    await h.applyConfigs([cfg()]);
    await h.handleEvent(baglandi('X'));
    expect(uyarilar(olaylar)).toEqual([]);
    expect(h.acikPluginler()).toEqual(['cbl-info']);
  });

  it('HİÇBİR yaptırım uygulanmaz — yalnızca uyarı', async () => {
    // Başka bir topluluğun kararına dayanarak oyuncu atmak, o kararı
    // incelemeden devralmak olurdu. Eski plugin de kimseyi atmıyordu.
    const { h, e } = kur(cblCevabi());
    await h.applyConfigs([cfg()]);
    await h.handleEvent(baglandi('Sorunlu'));
    expect(e.komutlar).toEqual([]);
  });
});

describe('elite-commander', () => {
  const oyuncu = (over: Partial<SquadJSOnlinePlayer> = {}): SquadJSOnlinePlayer =>
    ({
      steamId: '76561190000000001',
      eosId: null,
      name: 'Komutan',
      teamId: 1,
      squadId: 1,
      squadName: 'Command Squad',
      isLeader: true,
      role: 'r',
      ...over,
    }) as SquadJSOnlinePlayer;

  /**
   * `etiketler` yalnızca `seckinId`'ye verilir. Herkese aynı cevabı vermek
   * gerçekçi değil: komutan mangasındaki ikinci bir lider de seçkin
   * sayılıp ayrı bir duyuru üretirdi.
   */
  function kur(e: SahteEngine, etiketler: string[] | null, seckinId = '76561190000000001') {
    const h = new PluginHost({
      serverSlug: 'squad-01',
      engine: e,
      emit: () => undefined,
      sorgu: async (q) => {
        if (etiketler === null) return null;
        const id = (q as { steamId?: string }).steamId;
        return { bulundu: true, flags: id === seckinId ? etiketler : [] };
      },
    });
    h.register(eliteCommander);
    return h;
  }

  const cfg = {
    pluginName: 'elite-commander',
    enabled: true,
    config: { checkIntervalSeconds: 10 },
  };

  it('seçkin komutan göreve gelince duyurulur', async () => {
    const e = sahteEngine();
    e.oyuncular.push(oyuncu());
    const h = kur(e, ['Elite Commander']);
    await h.applyConfigs([cfg]);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(e.komutlar.some((c) => c.startsWith('AdminBroadcast'))).toBe(true);
  });

  it('etiketi olmayan komutan duyurulmaz', async () => {
    const e = sahteEngine();
    e.oyuncular.push(oyuncu());
    const h = kur(e, ['Baska Etiket']);
    await h.applyConfigs([cfg]);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(e.komutlar).toEqual([]);
  });

  it('komutan mangasında OLMAYAN lider duyurulmaz', async () => {
    // `isLeader` tek başına yetmez: her manga liderinin komutan sayılması
    // her turda yanlış duyuru demek olurdu.
    const e = sahteEngine();
    e.oyuncular.push(oyuncu({ squadName: 'ALPHA' }));
    const h = kur(e, ['Elite Commander']);
    await h.applyConfigs([cfg]);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(e.komutlar).toEqual([]);
  });

  it('aynı komutan her turda TEKRAR duyurulmaz', async () => {
    const e = sahteEngine();
    e.oyuncular.push(oyuncu());
    const h = kur(e, ['Elite Commander']);
    await h.applyConfigs([cfg]);

    await vi.advanceTimersByTimeAsync(10_000);
    const ilk = e.komutlar.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(e.komutlar).toHaveLength(ilk);
  });

  it('sorgu cevapsızsa duyuru yapılmaz', async () => {
    // Olmayan bir unvanı ilan etmek, eksik bir duyurudan kötü.
    const e = sahteEngine();
    e.oyuncular.push(oyuncu());
    const h = kur(e, null);
    await h.applyConfigs([cfg]);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(e.komutlar).toEqual([]);
  });

  it('aynı takımın manga liderleri uyarılır, komutan ve cmd squad hariç', async () => {
    const e = sahteEngine();
    e.oyuncular.push(
      oyuncu(),
      oyuncu({ steamId: '76561190000000002', name: 'SL1', squadName: 'ALPHA', squadId: 2 }),
      oyuncu({ steamId: '76561190000000003', name: 'CmdYardimci', squadName: 'Command Squad' }),
      oyuncu({ steamId: '76561190000000004', name: 'KarsiSL', teamId: 2, squadName: 'BRAVO' }),
      oyuncu({ steamId: '76561190000000005', name: 'Er', squadName: 'ALPHA', isLeader: false }),
    );
    const h = kur(e, ['Elite Commander']);
    await h.applyConfigs([cfg]);

    await vi.advanceTimersByTimeAsync(10_000);
    const warnler = e.komutlar.filter((c) => c.startsWith('AdminWarn'));
    expect(warnler).toHaveLength(1);
    expect(warnler[0]).toContain('76561190000000002');
  });

  it('yeni maçta durum sıfırlanır ve tekrar duyurulur', async () => {
    const e = sahteEngine();
    e.oyuncular.push(oyuncu());
    const h = kur(e, ['Elite Commander']);
    await h.applyConfigs([cfg]);

    await vi.advanceTimersByTimeAsync(10_000);
    const ilk = e.komutlar.length;

    await h.handleEvent({
      type: 'ROUND_STARTED',
      serverSlug: 'squad-01',
      timestamp: new Date().toISOString(),
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(e.komutlar.length).toBeGreaterThan(ilk);
  });
});

describe('squad-claim', () => {
  const kur = async (
    e: SahteEngine,
    config: Record<string, unknown> = {},
    admins: AdminIdentity[] = [],
  ) => {
    const h = host(e, admins);
    h.register(squadClaim);
    await h.applyConfigs([
      {
        pluginName: 'squad-claim',
        enabled: true,
        config: { adminCooldownSeconds: 0, playerCooldownSeconds: 0, ...config },
      },
    ]);
    return h;
  };

  const mangaKuruldu = (
    squadId: string,
    squadName: string,
    teamId: number,
    ms: number,
  ): AgentEvent => ({
    type: 'SQUAD_CREATED',
    serverSlug: 'squad-01',
    playerName: 'Kurucu',
    steamId: '76561190000000009',
    squadId,
    squadName,
    teamId,
    timestamp: new Date(ms).toISOString(),
  });

  function sahne(e: SahteEngine) {
    e.oyuncular.push(
      {
        steamId: '76561190000000001',
        eosId: null,
        name: 'Soran',
        teamId: 1,
        squadId: 1,
        squadName: 'ALPHA',
        isLeader: true,
        role: 'r',
      } as SquadJSOnlinePlayer,
      {
        steamId: '76561190000000002',
        eosId: null,
        name: 'Uye3',
        teamId: 1,
        squadId: 3,
        squadName: 'CHARLIE',
        isLeader: true,
        role: 'r',
      } as SquadJSOnlinePlayer,
      {
        steamId: '76561190000000003',
        eosId: null,
        name: 'Uye5',
        teamId: 1,
        squadId: 5,
        squadName: 'ECHO',
        isLeader: true,
        role: 'r',
      } as SquadJSOnlinePlayer,
    );
  }

  it('mangaları kuruluş sırasına göre listeler', async () => {
    const e = sahteEngine();
    sahne(e);
    const h = await kur(e);
    // 5 numaralı manga ÖNCE kuruldu.
    await h.handleEvent(mangaKuruldu('5', 'ECHO', 1, Date.UTC(2026, 0, 1, 10, 0, 0)));
    await h.handleEvent(mangaKuruldu('3', 'CHARLIE', 1, Date.UTC(2026, 0, 1, 10, 5, 0)));

    await h.handleEvent(komutMesaji('!claim 3 5'));

    const warn = e.komutlar.find((c) => c.startsWith('AdminWarn'));
    expect(warn).toBeDefined();
    const govde = warn as string;
    expect(govde.indexOf('Manga 5')).toBeLessThan(govde.indexOf('Manga 3'));
  });

  it('KARŞI takımın mangası sayılmaz', async () => {
    // Aynı numara iki takımda da var; karıştırmak yanlış mangayı gösterir.
    const e = sahteEngine();
    sahne(e);
    const h = await kur(e);
    await h.handleEvent(mangaKuruldu('3', 'CHARLIE', 2, Date.UTC(2026, 0, 1, 10, 0, 0)));
    await h.handleEvent(mangaKuruldu('5', 'ECHO', 1, Date.UTC(2026, 0, 1, 10, 5, 0)));

    await h.handleEvent(komutMesaji('!claim 3 5'));
    expect(e.komutlar[0]).toContain('En az iki geçerli');
  });

  it('tek numara yetersiz', async () => {
    const e = sahteEngine();
    sahne(e);
    const h = await kur(e);
    await h.handleEvent(komutMesaji('!claim 3'));
    expect(e.komutlar[0]).toContain('En az iki manga numarası');
  });

  it('round bitince liste SIFIRLANIR', async () => {
    // İddia yalnızca o maç içinde geçerli.
    const e = sahteEngine();
    sahne(e);
    const h = await kur(e);
    await h.handleEvent(mangaKuruldu('3', 'CHARLIE', 1, Date.UTC(2026, 0, 1, 10, 0, 0)));
    await h.handleEvent(mangaKuruldu('5', 'ECHO', 1, Date.UTC(2026, 0, 1, 10, 5, 0)));
    await h.handleEvent({
      type: 'ROUND_ENDED',
      serverSlug: 'squad-01',
      timestamp: new Date().toISOString(),
    });

    await h.handleEvent(komutMesaji('!claim 3 5'));
    expect(e.komutlar[0]).toContain('En az iki geçerli');
  });

  it('dağılmış manga listeden düşer', async () => {
    const e = sahteEngine();
    sahne(e);
    const h = await kur(e);
    await h.handleEvent(mangaKuruldu('3', 'CHARLIE', 1, Date.UTC(2026, 0, 1, 10, 0, 0)));
    await h.handleEvent(mangaKuruldu('7', 'GOLF', 1, Date.UTC(2026, 0, 1, 10, 1, 0)));
    await h.handleEvent(mangaKuruldu('5', 'ECHO', 1, Date.UTC(2026, 0, 1, 10, 5, 0)));

    // 7 numaralı mangada kimse yok -> dağılmış.
    await h.handleEvent(komutMesaji('!claim 3 5 7'));
    const warn = e.komutlar.find((c) => c.startsWith('AdminWarn')) as string;
    expect(warn).toContain('Bulunamadı: 7');
  });

  it('onlySquadLeader açıkken lider olmayan kullanamaz', async () => {
    const e = sahteEngine();
    sahne(e);
    const soran = e.oyuncular[0];
    if (soran) soran.isLeader = false;
    const h = await kur(e, { onlySquadLeader: true });
    await h.handleEvent(komutMesaji('!claim 3 5'));
    expect(e.komutlar[0]).toContain('manga liderleri');
  });

  it('bekleme süresi uygulanır', async () => {
    const e = sahteEngine();
    sahne(e);
    const h = await kur(e, { playerCooldownSeconds: 10 });
    await h.handleEvent(mangaKuruldu('3', 'CHARLIE', 1, Date.UTC(2026, 0, 1, 10, 0, 0)));
    await h.handleEvent(mangaKuruldu('5', 'ECHO', 1, Date.UTC(2026, 0, 1, 10, 5, 0)));

    await h.handleEvent(komutMesaji('!claim 3 5'));
    e.komutlar.length = 0;
    await h.handleEvent(komutMesaji('!claim 3 5'));
    expect(e.komutlar[0]).toContain('saniye bekle');
  });

  it('virgüllü yazım da kabul edilir', async () => {
    const e = sahteEngine();
    sahne(e);
    const h = await kur(e);
    await h.handleEvent(mangaKuruldu('3', 'CHARLIE', 1, Date.UTC(2026, 0, 1, 10, 0, 0)));
    await h.handleEvent(mangaKuruldu('5', 'ECHO', 1, Date.UTC(2026, 0, 1, 10, 5, 0)));

    await h.handleEvent(komutMesaji('!claim 3,5'));
    expect(e.komutlar.some((c) => c.includes('Manga 3'))).toBe(true);
  });
});

describe('admin-cam-watchlist', () => {
  function kur(
    e: SahteEngine,
    etiketliler: Array<{ steamId: string | null; eosId: string | null; flags: string[] }> | null,
    config: Record<string, unknown> = {},
    admins: AdminIdentity[] = [],
  ) {
    const sorulan: AgentQuery[] = [];
    const h = new PluginHost({
      serverSlug: 'squad-01',
      engine: e,
      emit: () => undefined,
      sorgu: async (q) => {
        sorulan.push(q);
        return etiketliler;
      },
    });
    if (admins.length > 0) h.adminListesiniGuncelle(admins);
    h.register(adminCamWatchlist);
    return {
      h,
      sorulan,
      hazir: h.applyConfigs([
        {
          pluginName: 'admin-cam-watchlist',
          enabled: true,
          config: { warnDelaySeconds: 0, adminCooldownSeconds: 0, ...config },
        },
      ]),
    };
  }

  function sahne(e: SahteEngine) {
    e.oyuncular.push(
      {
        steamId: '76561190000000001',
        eosId: null,
        name: 'Supheli',
        teamId: 1,
        squadId: 1,
        squadName: 'A',
        isLeader: false,
        role: 'r',
      } as SquadJSOnlinePlayer,
      {
        steamId: '76561190000000002',
        eosId: null,
        name: 'Temiz',
        teamId: 1,
        squadId: 1,
        squadName: 'A',
        isLeader: false,
        role: 'r',
      } as SquadJSOnlinePlayer,
    );
  }

  const kameraya = (steamId = '76561190000000009'): AgentEvent => ({
    type: 'ADMIN_ACTION',
    serverSlug: 'squad-01',
    action: 'cam_enter',
    steamId,
    timestamp: new Date().toISOString(),
  });

  it('kameraya geçen admine izlenen oyuncuları gösterir', async () => {
    const e = sahteEngine();
    sahne(e);
    const { h, hazir } = kur(e, [
      { steamId: '76561190000000001', eosId: null, flags: ['Hile Şüphelisi'] },
    ]);
    await hazir;
    await h.handleEvent(kameraya());

    expect(e.komutlar).toHaveLength(1);
    expect(e.komutlar[0]).toContain('Supheli');
    expect(e.komutlar[0]).toContain('Hile Şüphelisi');
  });

  it('TEK sorgu atılır — oyuncu başına değil', async () => {
    // Dolu sunucuda oyuncu başına sorgu, cevabı saniyelerce geciktirirdi.
    const e = sahteEngine();
    sahne(e);
    const { h, sorulan, hazir } = kur(e, []);
    await hazir;
    await h.handleEvent(kameraya());

    expect(sorulan).toHaveLength(1);
    expect(sorulan[0]?.kind).toBe('flagged_players');
  });

  it('izlenen kimse yoksa varsayılan olarak sessiz', async () => {
    const e = sahteEngine();
    sahne(e);
    const { h, hazir } = kur(e, []);
    await hazir;
    await h.handleEvent(kameraya());
    expect(e.komutlar).toEqual([]);
  });

  it('notifyWhenEmpty açıkken boş liste de bildirilir', async () => {
    const e = sahteEngine();
    sahne(e);
    const { h, hazir } = kur(e, [], { notifyWhenEmpty: true });
    await hazir;
    await h.handleEvent(kameraya());
    expect(e.komutlar[0]).toContain('izlenecek oyuncu yok');
  });

  it('sorgu cevapsızsa SESSIZ KALINMAZ', async () => {
    // Sessizlik, admine "izlenecek kimse yok" izlenimi verirdi; oysa
    // bilmiyoruz. İkisi farklı şeyler.
    const e = sahteEngine();
    sahne(e);
    const { h, hazir } = kur(e, null);
    await hazir;
    await h.handleEvent(kameraya());
    expect(e.komutlar[0]).toContain('alınamadı');
  });

  it('liste uzunsa kırpılır ve kalan sayısı yazılır', async () => {
    const e = sahteEngine();
    sahne(e);
    const cok = Array.from({ length: 20 }, (_, i) => ({
      steamId: `7656119000000${String(i).padStart(4, '0')}`,
      eosId: null,
      flags: ['İzlenecek Oyuncu'],
    }));
    const { h, hazir } = kur(e, cok, { maxPlayersInMessage: 5 });
    await hazir;
    await h.handleEvent(kameraya());
    expect(e.komutlar[0]).toContain('+15 kişi daha');
  });

  it('!takip komutu YETKİSİZ oyuncuda çalışmaz', async () => {
    // Kimin izlendiği moderasyon bilgisi; sızarsa izleme anlamını yitirir.
    const e = sahteEngine();
    sahne(e);
    const { h, hazir } = kur(e, [
      { steamId: '76561190000000001', eosId: null, flags: ['Hile Şüphelisi'] },
    ]);
    await hazir;
    await h.handleEvent(komutMesaji('!takip', 'Admin'));
    expect(e.komutlar).toEqual([]);
  });

  it('!takip komutu adminde listeyi gönderir', async () => {
    const e = sahteEngine();
    sahne(e);
    const { h, hazir } = kur(
      e,
      [{ steamId: '76561190000000001', eosId: null, flags: ['Hile Şüphelisi'] }],
      {},
      [{ steamId: '76561190000000001', groupName: 'Admin', permissions: 'kick,ban' }],
    );
    await hazir;
    await h.handleEvent(komutMesaji('!takip', 'Admin'));
    expect(e.komutlar[0]).toContain('Supheli');
  });

  it('bekleme süresi ikinci kamera geçişini susturur', async () => {
    const e = sahteEngine();
    sahne(e);
    const { h, hazir } = kur(
      e,
      [{ steamId: '76561190000000001', eosId: null, flags: ['Hile Şüphelisi'] }],
      { adminCooldownSeconds: 60 },
    );
    await hazir;
    await h.handleEvent(kameraya());
    expect(e.komutlar).toHaveLength(1);

    await h.handleEvent(kameraya());
    expect(e.komutlar).toHaveLength(1);
  });
});

describe('team-balancer', () => {
  const admin: AdminIdentity[] = [
    { steamId: '76561190000000001', groupName: 'Admin', permissions: 'kick,ban,balance' },
  ];

  function doldur(e: SahteEngine, kisiBasinaManga = 5) {
    let n = 0;
    for (const teamId of [1, 2]) {
      for (let s = 1; s <= 3; s++) {
        for (let i = 0; i < kisiBasinaManga; i++) {
          e.oyuncular.push({
            steamId: `7656119000000${String(n++).padStart(4, '0')}`,
            eosId: null,
            name: `O${n}`,
            teamId,
            squadId: s,
            squadName: `S${s}`,
            isLeader: i === 0,
            role: 'r',
          } as SquadJSOnlinePlayer);
        }
      }
    }
  }

  function kur(
    e: SahteEngine,
    maclar: Array<{
      winnerTeam: number | null;
      winnerTickets: number | null;
      loserTickets: number | null;
    }> | null,
    config: Record<string, unknown> = {},
    admins = admin,
  ) {
    const h = new PluginHost({
      serverSlug: 'squad-01',
      engine: e,
      emit: () => undefined,
      sorgu: async () => maclar,
    });
    if (admins.length > 0) h.adminListesiniGuncelle(admins);
    h.register(teamBalancer);
    return {
      h,
      hazir: h.applyConfigs([
        {
          pluginName: 'team-balancer',
          enabled: true,
          config: { announceDelaySeconds: 0, commandDelayMs: 0, minPlayers: 4, ...config },
        },
      ]),
    };
  }

  const macBitti = (kazananBilet?: number, kaybedenBilet?: number): AgentEvent => ({
    type: 'ROUND_ENDED',
    serverSlug: 'squad-01',
    winnerTeam: 1,
    ...(kazananBilet !== undefined ? { winnerTickets: kazananBilet } : {}),
    ...(kaybedenBilet !== undefined ? { loserTickets: kaybedenBilet } : {}),
    timestamp: new Date().toISOString(),
  });

  const mac = (t: number | null) => ({ winnerTeam: t, winnerTickets: null, loserTickets: null });

  it('seri eşiğe ulaşınca karıştırır', async () => {
    const e = sahteEngine();
    doldur(e);
    const { h, hazir } = kur(e, [mac(1), mac(1)], { maxWinStreak: 2, dominantWinTicketDiff: 0 });
    await hazir;
    await h.handleEvent(macBitti());

    expect(e.komutlar.some((c) => c.startsWith('AdminForceTeamChange'))).toBe(true);
  });

  it('seri eşiğin ALTINDAysa karıştırmaz', async () => {
    const e = sahteEngine();
    doldur(e);
    const { h, hazir } = kur(e, [mac(1), mac(2)], { maxWinStreak: 2, dominantWinTicketDiff: 0 });
    await hazir;
    await h.handleEvent(macBitti());

    expect(e.komutlar).toEqual([]);
  });

  it('maç geçmişi ALINAMAZSA karıştırmaz', async () => {
    // Bilmediğimiz bir seri yüzünden takımları dağıtmak, dengesizliği
    // düzeltmekten daha görünür bir hata.
    const e = sahteEngine();
    doldur(e);
    const { h, hazir } = kur(e, null, { maxWinStreak: 2, dominantWinTicketDiff: 0 });
    await hazir;
    await h.handleEvent(macBitti());

    expect(e.komutlar).toEqual([]);
  });

  it('ezici galibiyet seriyi beklemeden tetikler', async () => {
    const e = sahteEngine();
    doldur(e);
    const { h, hazir } = kur(e, [mac(2)], { maxWinStreak: 0, dominantWinTicketDiff: 250 });
    await hazir;
    await h.handleEvent(macBitti(400, 100));

    expect(e.komutlar.some((c) => c.startsWith('AdminForceTeamChange'))).toBe(true);
  });

  it('bilet farkı eşiğin altındaysa tetiklenmez', async () => {
    const e = sahteEngine();
    doldur(e);
    const { h, hazir } = kur(e, [mac(2)], { maxWinStreak: 0, dominantWinTicketDiff: 250 });
    await hazir;
    await h.handleEvent(macBitti(300, 200));

    expect(e.komutlar).toEqual([]);
  });

  it('az oyuncu varken karıştırmaz', async () => {
    const e = sahteEngine();
    const { h, hazir } = kur(e, [mac(1), mac(1)], { maxWinStreak: 2, minPlayers: 20 });
    await hazir;
    await h.handleEvent(macBitti());

    expect(e.komutlar.some((c) => c.startsWith('AdminForceTeamChange'))).toBe(false);
  });

  it('elle karıştırma ONAY ister', async () => {
    // Yanlışlıkla yazılan tek komut, dolu sunucudaki herkesin takımını
    // değiştirebilirdi.
    const e = sahteEngine();
    doldur(e);
    const { h, hazir } = kur(e, [mac(1)]);
    await hazir;
    await h.handleEvent(komutMesaji('!scramble', 'Admin'));

    expect(e.komutlar.some((c) => c.startsWith('AdminForceTeamChange'))).toBe(false);
    expect(e.komutlar[0]).toContain('Onaylamak için');
  });

  it('onaydan sonra karıştırır', async () => {
    const e = sahteEngine();
    doldur(e);
    const { h, hazir } = kur(e, [mac(1)]);
    await hazir;
    await h.handleEvent(komutMesaji('!scramble', 'Admin'));
    e.komutlar.length = 0;
    await h.handleEvent(komutMesaji('!scramble onayla', 'Admin'));

    expect(e.komutlar.some((c) => c.startsWith('AdminForceTeamChange'))).toBe(true);
  });

  it('bekleyen istek yokken onay reddedilir', async () => {
    const e = sahteEngine();
    doldur(e);
    const { h, hazir } = kur(e, [mac(1)]);
    await hazir;
    await h.handleEvent(komutMesaji('!scramble onayla', 'Admin'));

    expect(e.komutlar[0]).toContain('bekleyen bir karıştırma yok');
  });

  it('iptal bekleyen isteği düşürür', async () => {
    const e = sahteEngine();
    doldur(e);
    const { h, hazir } = kur(e, [mac(1)]);
    await hazir;
    await h.handleEvent(komutMesaji('!scramble', 'Admin'));
    await h.handleEvent(komutMesaji('!scramble iptal', 'Admin'));
    e.komutlar.length = 0;
    await h.handleEvent(komutMesaji('!scramble onayla', 'Admin'));

    expect(e.komutlar[0]).toContain('bekleyen bir karıştırma yok');
  });

  it('YETKİSİZ oyuncu karıştıramaz', async () => {
    const e = sahteEngine();
    doldur(e);
    const { h, hazir } = kur(e, [mac(1)], {}, []);
    await hazir;
    await h.handleEvent(komutMesaji('!scramble', 'Admin'));

    expect(e.komutlar).toEqual([]);
  });

  it('mangalar bozulmadan taşınır', async () => {
    // Bir manga ya tümüyle geçer ya da yerinde kalır.
    const e = sahteEngine();
    doldur(e, 5);
    const { h, hazir } = kur(e, [mac(1), mac(1)], {
      maxWinStreak: 2,
      dominantWinTicketDiff: 0,
      scramblePercentage: 0.5,
    });
    await hazir;
    await h.handleEvent(macBitti());

    const gecisler = e.komutlar.filter((c) => c.startsWith('AdminForceTeamChange'));
    // 15+15 oyuncu, %50 -> her taraftan en az 1 manga (5 kişi).
    expect(gecisler.length % 5).toBe(0);
    expect(gecisler.length).toBeGreaterThanOrEqual(10);
  });
});

describe('team-switch', () => {
  function doldur(e: SahteEngine, t1: number, t2: number) {
    let n = 0;
    for (const [teamId, adet] of [
      [1, t1],
      [2, t2],
    ] as const) {
      for (let i = 0; i < adet; i++) {
        e.oyuncular.push({
          steamId: `7656119000000${String(n++).padStart(4, '0')}`,
          eosId: null,
          name: `O${n}`,
          teamId,
          squadId: 1,
          squadName: 'A',
          isLeader: false,
          role: 'r',
        } as SquadJSOnlinePlayer);
      }
    }
  }

  function kur(
    e: SahteEngine,
    config: Record<string, unknown> = {},
    klanlar: Array<{
      steamId: string | null;
      eosId: string | null;
      clan: string;
      tag: string | null;
    }> | null = [],
  ) {
    const h = new PluginHost({
      serverSlug: 'squad-01',
      engine: e,
      emit: () => undefined,
      sorgu: async () => klanlar,
    });
    h.register(teamSwitch);
    return {
      h,
      hazir: h.applyConfigs([
        {
          pluginName: 'team-switch',
          enabled: true,
          config: { doubleSwitchDelayMs: 100, ...config },
        },
      ]),
    };
  }

  const ilkOyuncu = '76561190000000000';

  it('maçın başında geçişe izin verir', async () => {
    const e = sahteEngine();
    doldur(e, 10, 10);
    const { h, hazir } = kur(e);
    await hazir;
    await h.handleEvent(komutMesaji('!switch', 'All', ilkOyuncu));

    expect(e.komutlar.some((c) => c.startsWith('AdminForceTeamChange'))).toBe(true);
  });

  it('bekleme süresi dolmadan ikinci geçiş reddedilir', async () => {
    const e = sahteEngine();
    doldur(e, 10, 10);
    const { h, hazir } = kur(e, { switchCooldownHours: 3 });
    await hazir;
    await h.handleEvent(komutMesaji('!switch', 'All', ilkOyuncu));
    e.komutlar.length = 0;
    await h.handleEvent(komutMesaji('!switch', 'All', ilkOyuncu));

    expect(e.komutlar.some((c) => c.startsWith('AdminForceTeamChange'))).toBe(false);
    expect(e.komutlar[0]).toContain('bekle');
  });

  it('dengeyi bozacak geçiş reddedilir', async () => {
    const e = sahteEngine();
    doldur(e, 8, 12); // 1. takım az; 1'den 2'ye geçmek farkı açar
    const { h, hazir } = kur(e, { maxUnbalancedSlots: 3 });
    await hazir;
    await h.handleEvent(komutMesaji('!switch', 'All', ilkOyuncu));

    expect(e.komutlar[0]).toContain('dengesiz');
  });

  it('KARIŞTIRMA sonrası geçiş kapalı', async () => {
    // Olmasaydı karıştırılan oyuncular anında eski taraflarına dönerdi.
    const e = sahteEngine();
    doldur(e, 10, 10);
    const h = new PluginHost({ serverSlug: 'squad-01', engine: e, emit: () => undefined });
    h.register(teamSwitch, teamBalancer);
    await h.applyConfigs([
      { pluginName: 'team-switch', enabled: true, config: {} },
      {
        pluginName: 'team-balancer',
        enabled: true,
        config: {
          announceDelaySeconds: 0,
          commandDelayMs: 0,
          minPlayers: 4,
          scrambleLockdownMinutes: 20,
        },
      },
    ]);

    // Dengeleyiciyi elle çalıştır (admin komutu, onaysız).
    h.adminListesiniGuncelle([{ steamId: ilkOyuncu, groupName: 'Admin', permissions: 'kick,ban' }]);
    await h.applyConfigs([
      { pluginName: 'team-switch', enabled: true, config: {} },
      {
        pluginName: 'team-balancer',
        enabled: true,
        config: {
          announceDelaySeconds: 0,
          commandDelayMs: 0,
          minPlayers: 4,
          requireConfirmation: false,
          scrambleLockdownMinutes: 20,
        },
      },
    ]);
    await h.handleEvent(komutMesaji('!scramble', 'Admin', ilkOyuncu));
    e.komutlar.length = 0;

    await h.handleEvent(komutMesaji('!switch', 'All', '76561190000000005'));
    expect(e.komutlar.some((c) => c.startsWith('AdminForceTeamChange'))).toBe(false);
    expect(e.komutlar[0]).toContain('geçiş şu an kapalı');
  });

  it('!bug çift geçiş yapar ve dengeye bakmaz', async () => {
    // Net etkisi sıfır: oyuncu geldiği tarafa dönüyor.
    const e = sahteEngine();
    doldur(e, 8, 12);
    const { h, hazir } = kur(e);
    await hazir;
    // Sahte zamanlayıcıda önce işi başlat, sonra zamanı ilerlet: awaiting
    // etmek bekleyişi hiç çözülmeyen bir söze bağlardı.
    const is = h.handleEvent(komutMesaji('!bug', 'All', ilkOyuncu));
    await vi.advanceTimersByTimeAsync(200);
    await is;

    const gecisler = e.komutlar.filter((c) => c.startsWith('AdminForceTeamChange'));
    expect(gecisler).toHaveLength(2);
  });

  it('klan arkadaşları karşıdaysa süre sınırı atlanır', async () => {
    const e = sahteEngine();
    doldur(e, 10, 10);
    const { h, hazir } = kur(e, { switchEnabledMinutes: 5 }, [
      { steamId: ilkOyuncu, eosId: null, clan: 'ALTAI', tag: null },
      { steamId: '76561190000000010', eosId: null, clan: 'ALTAI', tag: null },
      { steamId: '76561190000000011', eosId: null, clan: 'ALTAI', tag: null },
    ]);
    await hazir;
    // Maç başlangıcını geçmişe it: normalde süre sınırı reddederdi.
    await h.handleEvent({
      type: 'ROUND_STARTED',
      serverSlug: 'squad-01',
      timestamp: new Date().toISOString(),
    });
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    await h.handleEvent(komutMesaji('!switch', 'All', ilkOyuncu));
    expect(e.komutlar.some((c) => c.startsWith('AdminForceTeamChange'))).toBe(true);
  });

  it('klan bilgisi alınamazsa muafiyet UYGULANMAZ', async () => {
    // Bilmediğimiz bir gerekçeyle kuralı gevşetmek, kuralı hiç
    // koymamakla aynı kapıya çıkar.
    const e = sahteEngine();
    doldur(e, 10, 10);
    const { h, hazir } = kur(e, { switchEnabledMinutes: 5 }, null);
    await hazir;
    await h.handleEvent({
      type: 'ROUND_STARTED',
      serverSlug: 'squad-01',
      timestamp: new Date().toISOString(),
    });
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    await h.handleEvent(komutMesaji('!switch', 'All', ilkOyuncu));
    expect(e.komutlar[0]).toContain('ilk 5 dakika');
  });

  it('süre sınırı dolunca geçiş reddedilir', async () => {
    const e = sahteEngine();
    doldur(e, 10, 10);
    const { h, hazir } = kur(e, { switchEnabledMinutes: 5 });
    await hazir;
    await h.handleEvent({
      type: 'ROUND_STARTED',
      serverSlug: 'squad-01',
      timestamp: new Date().toISOString(),
    });
    await vi.advanceTimersByTimeAsync(10 * 60_000);

    await h.handleEvent(komutMesaji('!switch', 'All', ilkOyuncu));
    expect(e.komutlar.some((c) => c.startsWith('AdminForceTeamChange'))).toBe(false);
  });
});

describe('admin-request', () => {
  function kur(e: SahteEngine, admins: AdminIdentity[] = [], config: Record<string, unknown> = {}) {
    const olaylar: AgentEvent[] = [];
    const h = new PluginHost({ serverSlug: 'squad-01', engine: e, emit: (ev) => olaylar.push(ev) });
    if (admins.length > 0) h.adminListesiniGuncelle(admins);
    h.register(adminRequest);
    return {
      h,
      olaylar,
      hazir: h.applyConfigs([
        { pluginName: 'admin-request', enabled: true, config: { cooldownSeconds: 0, ...config } },
      ]),
    };
  }

  function sahne(e: SahteEngine) {
    e.oyuncular.push(
      {
        steamId: '76561190000000001',
        eosId: null,
        name: 'Cagiran',
        teamId: 1,
        squadId: 1,
        squadName: 'A',
        isLeader: false,
        role: 'r',
      } as SquadJSOnlinePlayer,
      {
        steamId: '76561190000000002',
        eosId: null,
        name: 'Yetkili',
        teamId: 1,
        squadId: 1,
        squadName: 'A',
        isLeader: false,
        role: 'r',
      } as SquadJSOnlinePlayer,
    );
  }

  const cagrilar = (o: AgentEvent[]) =>
    o.filter((x) => x.type === 'ADMIN_REQUEST') as Extract<AgentEvent, { type: 'ADMIN_REQUEST' }>[];

  it('sebebiyle birlikte çağrı üretir', async () => {
    const e = sahteEngine();
    sahne(e);
    const { h, olaylar, hazir } = kur(e);
    await hazir;
    await h.handleEvent(komutMesaji('!admin hileci var', 'All'));

    const c = cagrilar(olaylar);
    expect(c).toHaveLength(1);
    expect(c[0]?.reason).toBe('hileci var');
    expect(c[0]?.playerName).toBe('Cagiran');
  });

  it('SEBEPSİZ çağrı da geçerli', async () => {
    // Aceleyle yalnızca !admin yazan biri gerçekten yardım istiyor
    // olabilir; düşürmek onu görmezden gelmek olurdu.
    const e = sahteEngine();
    sahne(e);
    const { h, olaylar, hazir } = kur(e);
    await hazir;
    await h.handleEvent(komutMesaji('!admin', 'All'));

    expect(cagrilar(olaylar)).toHaveLength(1);
  });

  it('çağırana HER ZAMAN cevap gider', async () => {
    const e = sahteEngine();
    sahne(e);
    const { h, hazir } = kur(e);
    await hazir;
    await h.handleEvent(komutMesaji('!admin', 'All'));

    expect(e.komutlar.some((c) => c.startsWith('AdminWarn 76561190000000001'))).toBe(true);
  });

  it('sunucudaki yetkili sayısı olaya yazılır', async () => {
    const e = sahteEngine();
    sahne(e);
    const { h, olaylar, hazir } = kur(e, [
      { steamId: '76561190000000002', groupName: 'Admin', permissions: 'kick,ban' },
    ]);
    await hazir;
    await h.handleEvent(komutMesaji('!admin', 'All'));

    expect(cagrilar(olaylar)[0]?.onlineAdmins).toBe(1);
  });

  it('yetkili yokken farklı mesaj gider', async () => {
    const e = sahteEngine();
    sahne(e);
    const { h, hazir } = kur(e);
    await hazir;
    await h.handleEvent(komutMesaji('!admin', 'All'));

    expect(e.komutlar[0]).toContain('yetkili yok');
  });

  it('bekleme süresi içinde ikinci çağrı reddedilir', async () => {
    const e = sahteEngine();
    sahne(e);
    const { h, olaylar, hazir } = kur(e, [], { cooldownSeconds: 120 });
    await hazir;
    await h.handleEvent(komutMesaji('!admin', 'All'));
    e.komutlar.length = 0;
    await h.handleEvent(komutMesaji('!admin', 'All'));

    expect(cagrilar(olaylar)).toHaveLength(1);
    expect(e.komutlar[0]).toContain('bekle');
  });

  it('uzun sebep kırpılır', async () => {
    const e = sahteEngine();
    sahne(e);
    const { h, olaylar, hazir } = kur(e, [], { maxReasonLength: 20 });
    await hazir;
    await h.handleEvent(komutMesaji(`!admin ${'a'.repeat(100)}`, 'All'));

    expect(cagrilar(olaylar)[0]?.reason).toHaveLength(20);
  });
});
