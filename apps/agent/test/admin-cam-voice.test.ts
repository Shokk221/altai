import type { AdminIdentity, AgentEvent, AgentQuery } from '@altai/contracts';
import type { SquadJSEngine, SquadJSOnlinePlayer } from '@altai/squad';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginHost } from '../src/plugin-host.js';
import { adminCamVoice } from '../src/plugins/admin-cam-voice.js';

/**
 * Yetkili kamerası ses denetimi.
 *
 * Bu plugin YETKİLİLERE yaptırım uyguluyor ve yanlış pozitifi doğrudan
 * onları vuruyor. Kilitlenen asıl kural: "ses bilgisi bilinmiyor" ile
 * "seste değil" ASLA aynı sayılmamalı — bot kapalıyken sunucudaki bütün
 * yetkililerin uyarı yemesi, eski sistemin gerçek şikâyetiydi.
 */

interface SahteEngine extends SquadJSEngine {
  komutlar: string[];
  oyuncular: SquadJSOnlinePlayer[];
}

function sahteEngine(): SahteEngine {
  const komutlar: string[] = [];
  const oyuncular: SquadJSOnlinePlayer[] = [];
  return {
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
}

const EOS = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const STEAM = '76561190000000001';

function kamera(action: 'cam_enter' | 'cam_exit'): AgentEvent {
  return {
    type: 'ADMIN_ACTION',
    serverSlug: 'squad-01',
    action,
    steamId: STEAM,
    eosId: EOS,
    playerName: 'Yetkili',
    timestamp: new Date().toISOString(),
  };
}

const SESTE = { bilinen: true, bagli: true, seste: true, kanal: 'Telsiz' };
const SESTE_DEGIL = { bilinen: true, bagli: true, seste: false, kanal: null };
const BAG_YOK = { bilinen: true, bagli: false, seste: false, kanal: null };
const BILINMIYOR = { bilinen: false, bagli: false, seste: false, kanal: null };

async function kur(
  cevap: unknown | null,
  config: Record<string, unknown> = {},
  admins: AdminIdentity[] = [],
) {
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
  if (admins.length > 0) h.adminListesiniGuncelle(admins);
  h.register(adminCamVoice);
  await h.applyConfigs([
    {
      pluginName: 'admin-cam-voice',
      enabled: true,
      config: { graceSeconds: 5, checkIntervalSeconds: 10, ...config },
    },
  ]);
  return { e, h, sorulan };
}

/** Kameraya sokar ve n tur denetim çalıştırır. */
async function turlar(h: PluginHost, n: number) {
  for (let i = 0; i < n; i++) await vi.advanceTimersByTimeAsync(10_000);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ses durumu bilinmiyorsa', () => {
  it('hiçbir yaptırım uygulamaz', async () => {
    // Botun kapalı olması yetkilinin suçu değil. Bilinmeyen bir durumu
    // ihlal saymak, altyapı arızasını yetkiliye fatura etmek olurdu.
    const { e, h } = await kur(BILINMIYOR, { maxWarnings: 1, kickEnabled: true });
    await h.handleEvent(kamera('cam_enter'));
    await turlar(h, 5);

    expect(e.komutlar).toEqual([]);
  });

  it('api hiç cevap vermezse de sessiz kalır', async () => {
    // null = sorgu kanalı kopuk. Aynı kural.
    const { e, h } = await kur(null, { maxWarnings: 1, kickEnabled: true });
    await h.handleEvent(kamera('cam_enter'));
    await turlar(h, 5);

    expect(e.komutlar).toEqual([]);
  });
});

describe('seste olan yetkili', () => {
  it('hiç uyarılmaz', async () => {
    const { e, h } = await kur(SESTE);
    await h.handleEvent(kamera('cam_enter'));
    await turlar(h, 5);

    expect(e.komutlar).toEqual([]);
  });
});

describe('seste olmayan yetkili', () => {
  it('hoşgörü süresi dolmadan uyarılmaz', async () => {
    // Kameraya yeni geçen biri telsiği açacak zamanı bulamadan uyarı almamalı.
    const { e, h } = await kur(SESTE_DEGIL, { graceSeconds: 60 });
    await h.handleEvent(kamera('cam_enter'));
    await turlar(h, 5); // 50 sn

    expect(e.komutlar).toEqual([]);
  });

  it('hoşgörü dolunca uyarılır', async () => {
    const { e, h } = await kur(SESTE_DEGIL);
    await h.handleEvent(kamera('cam_enter'));
    await turlar(h, 1);

    expect(e.komutlar.join('\n')).toContain('telsize gir');
  });

  it('kick kapalıyken uyarı sınırında atılmaz', async () => {
    // Bir yetkiliyi sunucudan atmak ağır bir yaptırım; varsayılan kapalı.
    const { e, h } = await kur(SESTE_DEGIL, { maxWarnings: 2, kickEnabled: false });
    await h.handleEvent(kamera('cam_enter'));
    await turlar(h, 6);

    expect(e.komutlar.some((c) => c.includes('AdminKick'))).toBe(false);
  });

  it('kick açıkken uyarı sınırında atılır', async () => {
    const { e, h } = await kur(SESTE_DEGIL, { maxWarnings: 2, kickEnabled: true });
    await h.handleEvent(kamera('cam_enter'));
    await turlar(h, 6);

    expect(e.komutlar.some((c) => c.includes('AdminKick'))).toBe(true);
  });

  it('atıldıktan sonra bir daha uyarılmaz', async () => {
    const { e, h } = await kur(SESTE_DEGIL, { maxWarnings: 1, kickEnabled: true });
    await h.handleEvent(kamera('cam_enter'));
    await turlar(h, 8);

    // Aynı kişiye sonsuza kadar uyarı yağdırmanın kimseye faydası yok.
    expect(e.komutlar.filter((c) => c.includes('AdminKick'))).toHaveLength(1);
  });
});

describe('Discord bağı olmayan yetkili', () => {
  it('kick edilmez, yönlendirilir', async () => {
    // Hesabını bağlamamış olmak, telsizden kaçmakla aynı şey değil.
    const { e, h } = await kur(BAG_YOK, { maxWarnings: 1, kickEnabled: true });
    await h.handleEvent(kamera('cam_enter'));
    await turlar(h, 4);

    const metin = e.komutlar.join('\n');
    expect(metin).toContain('/baglan');
    expect(e.komutlar.some((c) => c.includes('AdminKick'))).toBe(false);
  });
});

describe('kameradan çıkış', () => {
  it('çıkan yetkili artık denetlenmez', async () => {
    const { e, h } = await kur(SESTE_DEGIL);
    await h.handleEvent(kamera('cam_enter'));
    await h.handleEvent(kamera('cam_exit'));
    await turlar(h, 5);

    expect(e.komutlar).toEqual([]);
  });
});

describe('muafiyet', () => {
  it('muaf gruptaki yetkili hiç izlenmez', async () => {
    const { e, h } = await kur(SESTE_DEGIL, { exemptGroups: ['SuperAdmin'] }, [
      { steamId: STEAM, eosId: EOS, groupName: 'SuperAdmin', permissions: 'cameraman,kick' },
    ]);
    await h.handleEvent(kamera('cam_enter'));
    await turlar(h, 5);

    expect(e.komutlar).toEqual([]);
  });

  it('muaf olmayan grup normal denetlenir', async () => {
    const { e, h } = await kur(SESTE_DEGIL, { exemptGroups: ['SuperAdmin'] }, [
      { steamId: STEAM, eosId: EOS, groupName: 'Moderator', permissions: 'cameraman' },
    ]);
    await h.handleEvent(kamera('cam_enter'));
    await turlar(h, 2);

    expect(e.komutlar.join('\n')).toContain('telsize gir');
  });
});

describe('sorgu', () => {
  it('tazelik eşiğini ayardan geçirir', async () => {
    const { h, sorulan } = await kur(SESTE, { voiceMaxAgeSeconds: 120 });
    await h.handleEvent(kamera('cam_enter'));
    await turlar(h, 2);

    expect(sorulan[0]).toMatchObject({ kind: 'discord_voice', maxAgeSeconds: 120 });
  });

  it('kimse kamerada değilken hiç sorgu atmaz', async () => {
    const { sorulan, h } = await kur(SESTE);
    await turlar(h, 5);
    expect(sorulan).toEqual([]);
  });
});
