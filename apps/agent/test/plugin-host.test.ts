import type { AgentEvent } from '@altai/contracts';
import type { Plugin, SquadJSEngine, SquadJSOnlinePlayer } from '@altai/squad';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { PluginHost, tanimla } from '../src/plugin-host.js';

/**
 * PluginHost davranışı.
 *
 * Buradaki testlerin çoğu "olmaması gereken" durumları kilitliyor: sızan
 * zamanlayıcı, agent'ı düşüren plugin, doğrulanmamış ayarla açılan plugin.
 * Üçü de eski sistemde yaşanmış sınıflardı.
 */

function sahteEngine(): SquadJSEngine & { komutlar: string[]; oyuncular: SquadJSOnlinePlayer[] } {
  const komutlar: string[] = [];
  const oyuncular: SquadJSOnlinePlayer[] = [];
  return {
    serverSlug: 'squad-01',
    komutlar,
    oyuncular,
    on: () => undefined,
    off: () => undefined,
    getStatus: async () => ({}) as never,
    getPlayers: async () => oyuncular,
    refreshPlayers: async () => undefined,
    rconExecute: async (cmd: string) => {
      komutlar.push(cmd);
      return 'ok';
    },
  };
}

function host(engine: SquadJSEngine, emit: (e: AgentEvent) => void = () => undefined) {
  return new PluginHost({ serverSlug: 'squad-01', engine, emit });
}

const BosConfig = z.object({});

/** Her turda sayaç artıran, zamanlayıcı kuran basit plugin. */
function sayacPlugin(name: string, sayac: { n: number }): ReturnType<typeof tanimla> {
  return tanimla({
    name,
    description: 'test',
    configSchema: z.object({ ms: z.number().default(1000) }),
    create(ctx, config) {
      ctx.every(config.ms, () => {
        sayac.n += 1;
      });
      return {};
    },
  } satisfies Plugin<{ ms: number }>);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('applyConfigs', () => {
  it('yalnızca enabled olanı açar', async () => {
    const h = host(sahteEngine());
    const s = { n: 0 };
    h.register(sayacPlugin('a', s), sayacPlugin('b', { n: 0 }));

    await h.applyConfigs([
      { pluginName: 'a', enabled: true, config: {} },
      { pluginName: 'b', enabled: false, config: {} },
    ]);

    expect(h.acikPluginler()).toEqual(['a']);
  });

  it('listede olmayan plugin kapatılır', async () => {
    // Gelen küme TAM liste; panelden silinen ayar agent'ta asılı kalmamalı.
    const h = host(sahteEngine());
    h.register(sayacPlugin('a', { n: 0 }));
    await h.applyConfigs([{ pluginName: 'a', enabled: true, config: {} }]);
    expect(h.acikPluginler()).toEqual(['a']);

    await h.applyConfigs([]);
    expect(h.acikPluginler()).toEqual([]);
  });

  it('bilinmeyen plugin adı agent’ı düşürmez', async () => {
    const h = host(sahteEngine());
    await expect(
      h.applyConfigs([{ pluginName: 'boyle-bir-sey-yok', enabled: true, config: {} }]),
    ).resolves.toBeUndefined();
    expect(h.acikPluginler()).toEqual([]);
  });

  it('geçersiz ayarla plugin AÇILMAZ', async () => {
    // Yanlış ayarla çalışan plugin, kapalı plugin'den tehlikeli: canlı
    // sunucuda yanlış eşikle oyuncu atmaya başlayabilir.
    const h = host(sahteEngine());
    h.register(
      tanimla({
        name: 'katı',
        description: 'test',
        configSchema: z.object({ esik: z.number().min(1) }),
        create: () => ({}),
      } satisfies Plugin<{ esik: number }>),
    );

    await h.applyConfigs([{ pluginName: 'katı', enabled: true, config: { esik: 'metin' } }]);
    expect(h.acikPluginler()).toEqual([]);
  });

  it('create patlarsa host ayakta kalır', async () => {
    const h = host(sahteEngine());
    h.register(
      tanimla({
        name: 'patlak',
        description: 'test',
        configSchema: BosConfig,
        create: () => {
          throw new Error('bilerek');
        },
      } satisfies Plugin<Record<string, never>>),
    );

    await expect(
      h.applyConfigs([{ pluginName: 'patlak', enabled: true, config: {} }]),
    ).resolves.toBeUndefined();
    expect(h.acikPluginler()).toEqual([]);
  });
});

describe('zamanlayıcılar', () => {
  it('plugin kapanınca zamanlayıcı durur', async () => {
    const h = host(sahteEngine());
    const s = { n: 0 };
    h.register(sayacPlugin('a', s));

    await h.applyConfigs([{ pluginName: 'a', enabled: true, config: { ms: 100 } }]);
    await vi.advanceTimersByTimeAsync(350);
    const kapanmadanOnce = s.n;
    expect(kapanmadanOnce).toBeGreaterThan(0);

    await h.applyConfigs([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.n).toBe(kapanmadanOnce);
  });

  it('hot-reload zamanlayıcı SIZDIRMAZ', async () => {
    // Eski sistemin klasik hatası: her yeniden kurulumda bir zamanlayıcı
    // daha kalıyor ve duyurular ikişer üçer gitmeye başlıyordu.
    const h = host(sahteEngine());
    const s = { n: 0 };
    h.register(sayacPlugin('a', s));

    for (const ms of [100, 100, 100]) {
      // Ayar her seferinde DEĞİŞİYOR ki yeniden kurulum tetiklensin.
      await h.applyConfigs([{ pluginName: 'a', enabled: true, config: { ms, tur: s.n } }]);
    }

    s.n = 0;
    await vi.advanceTimersByTimeAsync(100);
    // Tek zamanlayıcı kalmalı: 100 ms'de tam 1 tur.
    expect(s.n).toBe(1);
  });

  it('ayar değişmediyse yeniden kurulmaz', async () => {
    const h = host(sahteEngine());
    let acilis = 0;
    h.register(
      tanimla({
        name: 'a',
        description: 'test',
        configSchema: BosConfig,
        create: () => {
          acilis += 1;
          return {};
        },
      } satisfies Plugin<Record<string, never>>),
    );

    await h.applyConfigs([{ pluginName: 'a', enabled: true, config: { x: 1 } }]);
    await h.applyConfigs([{ pluginName: 'a', enabled: true, config: { x: 1 } }]);
    expect(acilis).toBe(1);

    await h.applyConfigs([{ pluginName: 'a', enabled: true, config: { x: 2 } }]);
    expect(acilis).toBe(2);
  });
});

describe('olay dağıtımı', () => {
  // Sözleşmedeki şekle birebir uyuyor: `eosId` isteğe bağlı ve `null`
  // kabul etmiyor, o yüzden hiç konmuyor.
  const olay: AgentEvent = {
    type: 'PLAYER_CONNECTED',
    serverSlug: 'squad-01',
    steamId: '76561190000000001',
    name: 'Test',
    timestamp: new Date().toISOString(),
  };

  it('açık plugin olayı görür, kapalı görmez', async () => {
    const h = host(sahteEngine());
    const gorulen: string[] = [];
    h.register(
      tanimla({
        name: 'dinleyici',
        description: 'test',
        configSchema: BosConfig,
        create: () => ({
          onEvent: (e: AgentEvent) => {
            gorulen.push(e.type);
          },
        }),
      } satisfies Plugin<Record<string, never>>),
    );

    await h.handleEvent(olay);
    expect(gorulen).toEqual([]); // henüz açık değil

    await h.applyConfigs([{ pluginName: 'dinleyici', enabled: true, config: {} }]);
    await h.handleEvent(olay);
    expect(gorulen).toEqual(['PLAYER_CONNECTED']);
  });

  it('bir plugin olay işlerken patlarsa diğerleri çalışmaya devam eder', async () => {
    const h = host(sahteEngine());
    const gorulen: string[] = [];
    h.register(
      tanimla({
        name: 'patlak',
        description: 'test',
        configSchema: BosConfig,
        create: () => ({
          onEvent: () => {
            throw new Error('bilerek');
          },
        }),
      } satisfies Plugin<Record<string, never>>),
      tanimla({
        name: 'saglam',
        description: 'test',
        configSchema: BosConfig,
        create: () => ({
          onEvent: (e: AgentEvent) => {
            gorulen.push(e.type);
          },
        }),
      } satisfies Plugin<Record<string, never>>),
    );

    await h.applyConfigs([
      { pluginName: 'patlak', enabled: true, config: {} },
      { pluginName: 'saglam', enabled: true, config: {} },
    ]);
    await h.handleEvent(olay);
    expect(gorulen).toEqual(['PLAYER_CONNECTED']);
  });
});

describe('rcon yüzeyi', () => {
  it('satır sonu enjeksiyonunu temizler', async () => {
    // RCON metin argümanında satır sonu ikinci bir komut çalıştırabilir.
    const engine = sahteEngine();
    const h = host(engine);
    h.register(
      tanimla({
        name: 'duyuru',
        description: 'test',
        configSchema: BosConfig,
        async create(ctx) {
          await ctx.rcon.broadcast('merhaba\nAdminKickAll');
          return {};
        },
      } satisfies Plugin<Record<string, never>>),
    );

    await h.applyConfigs([{ pluginName: 'duyuru', enabled: true, config: {} }]);
    expect(engine.komutlar).toEqual(['AdminBroadcast merhaba AdminKickAll']);
  });
});
