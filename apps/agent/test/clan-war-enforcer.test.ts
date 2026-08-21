import type { AdminIdentity, AgentQuery } from '@altai/contracts';
import type { SquadJSEngine, SquadJSOnlinePlayer } from '@altai/squad';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginHost } from '../src/plugin-host.js';
import { clanWarEnforcer, kadrodaMi } from '../src/plugins/clan-war-enforcer.js';

/**
 * Klan savaşı yaptırımı.
 *
 * Bu plugin İNSANLARI SUNUCUDAN ATIYOR ve yanlışı doğrudan maçı bozuyor.
 * Kilitlenen üç kural: kadro alınamazsa kimse atılmaz, savaş yoksa kimse
 * atılmaz, ve kadro BOŞ gelirse kimse atılmaz (o durumda sunucudaki
 * herkes atılırdı).
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

const oyuncu = (steamId: string, eosId: string, name: string): SquadJSOnlinePlayer => ({
  steamId,
  eosId,
  name,
  teamId: 1,
  squadId: null,
  squadName: null,
  role: null,
  isLeader: false,
});

const KADRODA = oyuncu('76561190000000001', 'eos-a', 'Kadrolu');
const KADRO_DISI = oyuncu('76561190000000002', 'eos-b', 'Yabanci');

const AKTIF_KADRO = {
  aktif: true,
  warId: 'w1',
  name: 'Final',
  steamIds: ['76561190000000001'],
  eosIds: ['eos-a'],
};
const SAVAS_YOK = { aktif: false, warId: null, name: null, steamIds: [], eosIds: [] };
const BOS_KADRO = { aktif: true, warId: 'w1', name: 'Final', steamIds: [], eosIds: [] };

async function kur(
  cevap: unknown | null,
  config: Record<string, unknown> = {},
  admins: AdminIdentity[] = [],
) {
  const e = sahteEngine();
  e.oyuncular.push(KADRODA, KADRO_DISI);
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
  if (admins.length > 0) h.adminListesiniGuncelle(admins);
  h.register(clanWarEnforcer);
  await h.applyConfigs([
    {
      pluginName: 'clan-war-enforcer',
      enabled: true,
      config: { checkIntervalSeconds: 10, graceSeconds: 20, ...config },
    },
  ]);
  return { e, h, sorulan };
}

const tur = async (n: number) => {
  for (let i = 0; i < n; i++) await vi.advanceTimersByTimeAsync(10_000);
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('kadrodaMi', () => {
  it('SteamID ile eşleşir', () => {
    expect(kadrodaMi({ steamId: '1' }, { steamIds: ['1'], eosIds: [] })).toBe(true);
  });

  it('EOS ile eşleşir — büyük/küçük harf duyarsız', () => {
    // Squad oyuncuyu EOS ile tanıyor; kadro SteamID ile giriliyor.
    // Yalnızca birine bakmak, kimliklerinden biri eksik olan oyuncuları
    // haksız yere attırırdı.
    expect(kadrodaMi({ eosId: 'ABC' }, { steamIds: [], eosIds: ['abc'] })).toBe(true);
  });

  it('hiçbiri eşleşmezse false', () => {
    expect(kadrodaMi({ steamId: '9', eosId: 'z' }, { steamIds: ['1'], eosIds: ['a'] })).toBe(false);
  });

  it('kimliksiz oyuncu kadroda sayılmaz', () => {
    expect(kadrodaMi({}, { steamIds: ['1'], eosIds: ['a'] })).toBe(false);
  });
});

describe('yaptırım', () => {
  it('kadro ALINAMAZSA kimseye dokunmaz', async () => {
    // Bir bağlantı kesintisi yüzünden maçtaki oyuncuları atmak,
    // yaptırımın önlemeye çalıştığı şeyin ta kendisi olurdu.
    const { e, h } = await kur(null);
    await tur(6);
    expect(e.komutlar).toEqual([]);
  });

  it('savaş yoksa kimseye dokunmaz', async () => {
    const { e, h } = await kur(SAVAS_YOK);
    await tur(6);
    expect(e.komutlar).toEqual([]);
  });

  it('kadro BOŞ gelirse kimseyi atmaz', async () => {
    // Bu koşulun yanlış olması sunucudaki HERKESİ atmak demek.
    const { e, h } = await kur(BOS_KADRO);
    await tur(6);
    expect(e.komutlar).toEqual([]);
  });

  it('kadrodaki oyuncuya dokunmaz', async () => {
    const { e, h } = await kur(AKTIF_KADRO);
    await tur(6);
    expect(e.komutlar.join('\n')).not.toContain('76561190000000001');
    expect(e.komutlar.join('\n')).not.toContain('eos-a');
  });

  it('kadro dışını ÖNCE uyarır, hemen atmaz', async () => {
    // Sunucuya yanlışlıkla giren biri uyarıyı okuyup kendi çıkabilmeli.
    const { e, h } = await kur(AKTIF_KADRO);
    await tur(1);
    const metin = e.komutlar.join('\n');
    expect(metin).toContain('klan savaşı');
    expect(e.komutlar.some((c) => c.includes('AdminKick'))).toBe(false);
  });

  it('hoşgörü dolunca atar', async () => {
    const { e, h } = await kur(AKTIF_KADRO, { graceSeconds: 20 });
    await tur(4);
    expect(e.komutlar.some((c) => c.includes('AdminKick'))).toBe(true);
  });

  it('yetkiliyi muaf tutar', async () => {
    // Maçı yöneten yetkilinin sunucuda olması gerekiyor; onu kadroya
    // yazmak, kadroyu oyuncu listesi olmaktan çıkarırdı.
    const { e, h } = await kur(AKTIF_KADRO, { exemptAdmins: true }, [
      {
        steamId: KADRO_DISI.steamId,
        eosId: KADRO_DISI.eosId,
        groupName: 'Admin',
        permissions: 'kick',
      },
    ]);
    await tur(6);
    expect(e.komutlar).toEqual([]);
  });

  it('muafiyet kapalıyken yetkiliyi de atar', async () => {
    const { e, h } = await kur(AKTIF_KADRO, { exemptAdmins: false }, [
      {
        steamId: KADRO_DISI.steamId,
        eosId: KADRO_DISI.eosId,
        groupName: 'Admin',
        permissions: 'kick',
      },
    ]);
    await tur(4);
    expect(e.komutlar.some((c) => c.includes('AdminKick'))).toBe(true);
  });
});
