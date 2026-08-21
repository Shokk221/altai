import type { AgentEvent, AgentQuery } from '@altai/contracts';
import type { SquadJSEngine, SquadJSOnlinePlayer } from '@altai/squad';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginHost } from '../src/plugin-host.js';
import { parcala, rules } from '../src/plugins/rules.js';

/**
 * Oyun içi kural gösterimi.
 *
 * İki kritik kural: api'ye ulaşılamadığında oyuncuya "kural yok" DENMEZ
 * (kuralsız bir sunucuda olduğunu düşünürdü), ve kesilen listede kesildiği
 * SÖYLENİR (görmediği kuralların olmadığını sanmasın).
 */

interface SahteEngine extends SquadJSEngine {
  komutlar: string[];
}

function sahteEngine(): SahteEngine {
  const komutlar: string[] = [];
  const oyuncular: SquadJSOnlinePlayer[] = [];
  return {
    serverSlug: 'squad-01',
    komutlar,
    on: () => undefined,
    off: () => undefined,
    getPlayers: async () => oyuncular,
    refreshPlayers: async () => undefined,
    getStatus: async () => ({ playerCount: 0, publicQueue: 0 }),
    rconExecute: async (cmd: string) => {
      komutlar.push(cmd);
      return 'ok';
    },
  } as unknown as SahteEngine;
}

const sohbet = (mesaj: string): AgentEvent => ({
  type: 'CHAT_MESSAGE',
  serverSlug: 'squad-01',
  steamId: '76561190000000001',
  channel: 'All',
  message: mesaj,
  timestamp: new Date().toISOString(),
});

const KURAL = (position: number, title: string, body = 'Metin.') => ({
  position,
  title,
  body,
  category: null,
});

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
  h.register(rules);
  await h.applyConfigs([
    { pluginName: 'rules', enabled: true, config: { cooldownSeconds: 0, ...config } },
  ]);
  return { e, h, sorulan };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('!kurallar', () => {
  it('başlıkları numaralı listeler', async () => {
    const { e, h } = await kur([KURAL(0, 'TK yapma'), KURAL(1, 'Küfür yok')]);
    await h.handleEvent(sohbet('!kurallar'));

    const metin = e.komutlar.join('\n');
    expect(metin).toContain('1. TK yapma');
    expect(metin).toContain('2. Küfür yok');
  });

  it('api ULAŞILAMAZSA "kural yok" demez', async () => {
    // Oyuncuya kuralsız bir sunucuda olduğunu söylemek, sessiz bir
    // hatadan daha kötü.
    const { e, h } = await kur(null);
    await h.handleEvent(sohbet('!kurallar'));

    const metin = e.komutlar.join('\n');
    expect(metin).toContain('alınamıyor');
    expect(metin).not.toContain('tanımlı kural yok');
  });

  it('gerçekten kural yoksa öyle söyler', async () => {
    const { e, h } = await kur([]);
    await h.handleEvent(sohbet('!kurallar'));
    expect(e.komutlar.join('\n')).toContain('tanımlı kural yok');
  });

  it('liste kesilirse kesildiğini söyler', async () => {
    // Sessizce kırpılan bir liste, oyuncuya görmediği kuralların
    // olmadığını düşündürür.
    const cok = Array.from({ length: 20 }, (_, i) => KURAL(i, `Kural ${i}`));
    const { e, h } = await kur(cok, { maxListed: 5 });
    await h.handleEvent(sohbet('!kurallar'));

    expect(e.komutlar.join('\n')).toContain('15 kural daha');
  });
});

describe('!kural <n>', () => {
  it('numaraya karşılık gelen kuralın tam metnini gösterir', async () => {
    const { e, h } = await kur([
      KURAL(0, 'TK yapma', 'Takım arkadaşını öldürme.'),
      KURAL(5, 'Küfür yok', 'Sohbette küfür yasak.'),
    ]);
    await h.handleEvent(sohbet('!kural 2'));

    const metin = e.komutlar.join('\n');
    // İkinci kuralın `position` değeri 5 ama oyuncu LİSTEDEKİ 2. kuralı
    // soruyor; aradaki boşluklar oyuncunun sorunu değil.
    expect(metin).toContain('Küfür yok');
    expect(metin).toContain('Sohbette küfür yasak.');
  });

  it('geçersiz numarada aralığı söyler', async () => {
    const { e, h } = await kur([KURAL(0, 'Tek kural')]);
    await h.handleEvent(sohbet('!kural 7'));
    expect(e.komutlar.join('\n')).toContain('1 ile 1 arası');
  });

  it('sayı olmayan argümanı reddeder', async () => {
    const { e, h } = await kur([KURAL(0, 'Tek kural')]);
    await h.handleEvent(sohbet('!kural abc'));
    expect(e.komutlar.join('\n')).toContain('Geçersiz numara');
  });
});

describe('bekleme süresi', () => {
  it('sessiz kalmaz, kalan süreyi söyler', async () => {
    const { e, h } = await kur([KURAL(0, 'Kural')], { cooldownSeconds: 60 });
    await h.handleEvent(sohbet('!kurallar'));
    e.komutlar.length = 0;

    await h.handleEvent(sohbet('!kurallar'));
    expect(e.komutlar.join('\n')).toContain('yavaş');
  });
});

describe('parcala', () => {
  it('kısa metni bölmez', () => {
    expect(parcala('Kısa metin.')).toEqual(['Kısa metin.']);
  });

  it('uzun metni KELİME sınırından böler', () => {
    // Karakter sayısına göre kesmek kelimeleri ortadan ikiye ayırıyor ve
    // kural metni okunamaz hâle geliyordu.
    const metin = Array.from({ length: 60 }, () => 'kelime').join(' ');
    const parcalar = parcala(metin, 50);

    expect(parcalar.length).toBeGreaterThan(1);
    for (const p of parcalar) {
      expect(p.length).toBeLessThanOrEqual(50);
      // Hiçbir parça yarım kelimeyle başlamamalı/bitmemeli.
      expect(p.split(' ').every((k) => k === 'kelime')).toBe(true);
    }
  });

  it('sınırdan uzun tek kelimeyi kendi parçasına koyar', () => {
    // Bölmek bir bağlantıyı kullanılamaz yapardı.
    const uzun = 'x'.repeat(80);
    expect(parcala(`kısa ${uzun} son`, 40)).toContain(uzun);
  });

  it('birleştirildiğinde metnin tamamı korunur', () => {
    const metin = Array.from({ length: 40 }, (_, i) => `k${i}`).join(' ');
    expect(parcala(metin, 30).join(' ')).toBe(metin);
  });

  it('boş metinde boş dizi döner', () => {
    expect(parcala('   ')).toEqual([]);
  });
});
