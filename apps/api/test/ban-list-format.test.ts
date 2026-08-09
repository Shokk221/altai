import { describe, expect, it } from 'vitest';
import { type BanListEntry, formatBanList, renderReason } from '../src/lib/ban-list-format.js';

/**
 * Ban listesi doğrudan oyun sunucusuna gidiyor. Bozuk bir satır iki yönde de
 * hatalı: ya banlı bir oyuncu içeri girer, ya masum biri dışarıda kalır.
 * Biçim gerçek sunucudaki RemoteBanListHosts.cfg başlığından alındı:
 *   <id>:<unban zaman damgasi> //Sebep
 */

const NOW = new Date('2026-08-09T12:00:00.000Z');

function entry(over: Partial<BanListEntry> = {}): BanListEntry {
  return {
    steamId: '76561198000000001',
    eosId: '0002eaff43e44e6cb95207bab755c353',
    reason: 'main camp',
    expiresAt: null,
    ...over,
  };
}

/** Başlık yorumlarını atıp yalnızca kayıt satırlarını döndürür. */
function records(out: string): string[] {
  return out
    .split('\n')
    .filter((l) => l && !l.startsWith('//'))
    .map((l) => l.trim());
}

describe('formatBanList', () => {
  it('kalıcı banı 0 zaman damgasıyla yazar', () => {
    const out = formatBanList({ entries: [entry({ expiresAt: null })], now: NOW });
    expect(records(out)).toContain('0002eaff43e44e6cb95207bab755c353:0 //main camp');
  });

  it('süreli banı unix saniyesiyle yazar', () => {
    const expiresAt = new Date('2026-08-10T00:00:00.000Z');
    const out = formatBanList({ entries: [entry({ expiresAt })], now: NOW });
    const ts = Math.floor(expiresAt.getTime() / 1000);
    expect(records(out)[0]).toBe(`0002eaff43e44e6cb95207bab755c353:${ts} //main camp`);
  });

  it('hem EOS hem Steam kimliğini yazar (Squad ikisini de tanıyor)', () => {
    const out = records(formatBanList({ entries: [entry()], now: NOW }));
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('0002eaff43e44e6cb95207bab755c353');
    expect(out[1]).toContain('76561198000000001');
  });

  it('EOS yoksa yalnızca Steam ile yazar', () => {
    const out = records(formatBanList({ entries: [entry({ eosId: null })], now: NOW }));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('76561198000000001');
  });

  it('hiç kimlik yoksa satır üretmez', () => {
    const out = records(
      formatBanList({ entries: [entry({ eosId: null, steamId: null })], now: NOW }),
    );
    expect(out).toHaveLength(0);
  });

  it('süresi dolmuş banı listeye almaz', () => {
    const out = records(
      formatBanList({
        entries: [entry({ expiresAt: new Date('2026-08-09T11:59:00.000Z') })],
        now: NOW,
      }),
    );
    expect(out).toHaveLength(0);
  });

  it('sebepteki satır sonu listeyi bozmaz', () => {
    // Bu olmasaydı ikinci satır geçersiz bir kayıt olarak parse edilirdi.
    const out = formatBanList({
      entries: [entry({ reason: 'hile\nikinci satir\r\nucuncu' })],
      now: NOW,
    });
    for (const line of records(out)) {
      expect(line).toMatch(/^[0-9a-f]+:\d+ \/\//);
    }
    expect(records(out)[0]).toContain('hile ikinci satir ucuncu');
  });

  it('aynı kimlik iki kez yazılmaz', () => {
    const out = records(formatBanList({ entries: [entry(), entry()], now: NOW }));
    expect(new Set(out).size).toBe(out.length);
  });

  it('başlıkta tekil ban, girdi sayısı ve satır sayısı doğru', () => {
    const out = formatBanList({
      entries: [entry(), entry({ steamId: '76561198000000002', eosId: null })],
      now: NOW,
    });
    expect(out).toContain('2 tekil ban (2 kayıttan), 3 kimlik satırı');
  });

  it('aynı oyuncuya aynı bitişle atılmış tekrar banlar tek sayılır', () => {
    // Gerçek veride bu çok yaygın: BM'de aynı oyuncuya aynı bitiş tarihiyle
    // 5-6 otomatik TK banı atılmış. 21.783 aktif kayıt -> 11.518 tekil ban.
    // Başlık bu farkı açıkça göstermeli, yoksa veri kaybı sanılır.
    const out = formatBanList({ entries: [entry(), entry(), entry()], now: NOW });
    expect(out).toContain('1 tekil ban (3 kayıttan), 2 kimlik satırı');
    expect(records(out)).toHaveLength(2);
  });

  it('çıktı satır sonu ile biter (sunucu son satırı kırpmasın)', () => {
    expect(formatBanList({ entries: [entry()], now: NOW }).endsWith('\n')).toBe(true);
  });
});

describe('renderReason', () => {
  it('BM şablon yer tutucularını doldurur', () => {
    // Arşivdeki gerçek sebep metni bu şablonları içeriyor; ham bırakılırsa
    // oyuncu ban ekranında literal "{{expires}}" görür.
    const expiresAt = new Date('2026-08-10T00:00:00.000Z');
    const out = renderReason('main camp | {{expires}} | {{timeLeft}}', expiresAt, NOW);
    expect(out).not.toContain('{{');
    expect(out).toContain('2026-08-10 00:00');
    expect(out).toContain('12 saat');
  });

  it('kalıcı banda yer tutucular "kalıcı" olur', () => {
    const out = renderReason('hile | {{expires}} | {{timeLeft}}', null, NOW);
    expect(out).toContain('kalıcı');
    expect(out).not.toContain('{{');
  });

  it('çok uzun sebebi kırpar', () => {
    const out = renderReason('x'.repeat(500), null, NOW);
    expect(out.length).toBeLessThanOrEqual(180);
    expect(out.endsWith('…')).toBe(true);
  });
});
