import type { AdminIdentity, AgentEvent, AgentQuery } from '@altai/contracts';
import type { SquadJSEngine, SquadJSOnlinePlayer } from '@altai/squad';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginHost } from '../src/plugin-host.js';
import {
  autoTkWarn,
  nameEnforcer,
  playtimeSquadGuard,
  slBanEnforcer,
  slKitEnforcer,
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
