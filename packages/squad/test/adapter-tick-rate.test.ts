import type { AgentEvent } from '@altai/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSquadJSAdapter } from '../src/adapter.js';
import type { SquadJSEngine, SquadJSEngineEvents } from '../src/engine.js';

/**
 * TPS'in snapshot'a nasıl bindiği.
 *
 * Değer yalnızca oyun log'undan geliyor; RCON'da karşılığı yok. Bu iki
 * davranış test altında çünkü ikisinin de bozulması sessiz olur:
 *  - TPS gelmiyorsa ekranda hiç görünmemeli (yerine 0 yazmak "sunucu
 *    donmuş" demek olurdu),
 *  - log akışı durduysa son bilinen değer saatlerce "canlı" görünmemeli.
 */

function kurulum(snapshotIntervalMs: number) {
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
      return { playerCount: 42, publicQueue: 3, currentLayer: 'Yehorivka RAAS v1' };
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
    snapshotIntervalMs,
  });
  adapter.start();

  const yay = (event: string, raw: unknown) => {
    for (const l of dinleyiciler.get(event) ?? []) (l as (r: unknown) => void)(raw);
  };

  const sonSnapshot = () => {
    const hepsi = olaylar.filter((o) => o.type === 'SERVER_SNAPSHOT');
    return hepsi.at(-1);
  };

  return { olaylar, yay, adapter, sonSnapshot };
}

describe('snapshot üzerinde tick hızı', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('log’dan gelen tick hızını bir sonraki snapshot’a bindirir', async () => {
    const { yay, sonSnapshot } = kurulum(60_000);
    yay('TICK_RATE', { tickRate: 42.53 });
    await vi.advanceTimersByTimeAsync(60_000);

    const s = sonSnapshot();
    expect(s?.type).toBe('SERVER_SNAPSHOT');
    expect(s && 'tickRate' in s ? s.tickRate : undefined).toBe(42.53);
  });

  it('hiç tick satırı görülmediyse alanı göndermez', async () => {
    const { sonSnapshot } = kurulum(60_000);
    await vi.advanceTimersByTimeAsync(60_000);

    const s = sonSnapshot();
    expect(s && 'tickRate' in s ? s.tickRate : undefined).toBeUndefined();
  });

  it('bayat değeri göndermez — log akışı durmuş olabilir', async () => {
    const { yay, sonSnapshot } = kurulum(60_000);
    yay('TICK_RATE', { tickRate: 39 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sonSnapshot() && 'tickRate' in (sonSnapshot() as object)).toBe(true);

    // Üç dakikadan uzun süre yeni satır yok: değer artık sunucunun bugünkü
    // hâlini anlatmıyor.
    await vi.advanceTimersByTimeAsync(4 * 60_000);
    const s = sonSnapshot();
    expect(s && 'tickRate' in s ? s.tickRate : undefined).toBeUndefined();
  });

  it('NaN tick hızını yok sayar', async () => {
    const { yay, sonSnapshot } = kurulum(60_000);
    yay('TICK_RATE', { tickRate: Number.NaN });
    await vi.advanceTimersByTimeAsync(60_000);

    const s = sonSnapshot();
    expect(s && 'tickRate' in s ? s.tickRate : undefined).toBeUndefined();
  });
});
