import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { yaptirimKaynakKosulu } from '../src/lib/ban-active.js';
import { formatBanList } from '../src/lib/ban-list-format.js';

/**
 * `altai` kipinin güvenlik valfi HER İKİ yaptırım yolunda da olmalı.
 *
 * NEDEN BU TEST VAR: valf aylarca yalnızca bir yolda vardı.
 *
 *   1. ban-enforcer  — girişte canlı RCON kicki        (valf vardı)
 *   2. ban-list ucu  — oyun sunucusunun çektiği .cfg   (valf YOKTU)
 *
 * İkinci yoldaki eksik, davranış testiyle de gözle de görünmüyordu: uç
 * bugüne kadar hiç çekilmedi (erişim kaydında yalnızca loopback testleri
 * var), yani hata ancak oyun sunucusu bu uca çevrildiği GÜN ortaya
 * çıkacaktı — valfin asıl gerekli olduğu anda. O gün dondurulmuş BM
 * arşivinin tamamı tek seferde uygulanmaya başlardı.
 *
 * Aynı sınıf hata ban sebebi render'ında da yaşandı (bkz.
 * ban-sebebi-renderlenir.test.ts): fonksiyon doğruydu, ATLANAN ŞEY ÇAĞRI
 * YERİYDİ. O yüzden burada hem kuralın kendisi hem çağrı yerleri var.
 */

const KOK = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const oku = (kisa: string) => readFileSync(join(KOK, kisa), 'utf8');
const sql = (kosul: ReturnType<typeof yaptirimKaynakKosulu>) =>
  kosul ? new PgDialect().sqlToQuery(kosul) : null;

describe('yaptirimKaynakKosulu', () => {
  it('altai kipinde kaynağı altai olanlara süzer', () => {
    const q = sql(yaptirimKaynakKosulu('altai'));
    expect(q, 'altai kipinde süzme ŞART — valfin tamamı bu').not.toBeNull();
    expect(q?.sql).toContain('source');
    expect(q?.params).toContain('altai');
  });

  it('on kipinde süzmez — tüm banlar uygulanır', () => {
    expect(yaptirimKaynakKosulu('on')).toBeUndefined();
  });

  // `dry` ve `off` kickin YAPILIP YAPILMAYACAĞINI belirliyor, hangi banların
  // geçerli olduğunu değil. Liste için anlamlarını icat etmiyoruz.
  it('dry ve off kipleri kaynağa göre süzmez', () => {
    expect(yaptirimKaynakKosulu('dry')).toBeUndefined();
    expect(yaptirimKaynakKosulu('off')).toBeUndefined();
  });
});

describe('valf tek yerde duruyor', () => {
  /**
   * EN ÖNEMLİ İDDİA. Valfin iki kopyası olursa birinde yapılan düzeltme
   * diğerine geçmez — zaten tam bu yüzden bir yol valfsiz kaldı. Bu yüzden
   * `bans.source` karşılaştırması api kaynağında TEK yerde olmalı.
   */
  it('bans.source karşılaştırması yalnızca ban-active.ts içinde', () => {
    const dosyalar = ['lib/ban-active.ts', 'lib/ban-enforcer.ts', 'routes/ban-list.ts'];
    const sayim = dosyalar.map((d) => [d, (oku(d).match(/bans\.source/g) ?? []).length] as const);
    expect(sayim.find(([d]) => d === 'lib/ban-active.ts')?.[1]).toBeGreaterThan(0);
    for (const [dosya, adet] of sayim.filter(([d]) => d !== 'lib/ban-active.ts')) {
      const ipucu = 'valfin ikinci kopyası olmamalı — ban-active.ts → yaptirimKaynakKosulu';
      expect(adet, `${dosya} kaynak filtresini kendi yazıyor: ${ipucu}`).toBe(0);
    }
  });
});

describe('her iki yaptırım yolu valfi kullanıyor', () => {
  // SINIRI AÇIK: bu iki iddia metin arıyor, davranış ölçmüyor. Bilinen iki
  // yolu koruyor; üçüncü bir yol eklenirse onu yakalamaz.
  it('ban-list ucu valfi çağırıyor', () => {
    expect(
      oku('routes/ban-list.ts'),
      'ban-list ucu kaynak valfini uygulamıyor: oyun sunucusu bu uca çevrildiği gün ' +
        'dondurulmuş BM arşivinin tamamı uygulanmaya başlar. ' +
        'Çözüm: and(active, yaptirimKaynakKosulu(config.BAN_ENFORCEMENT))',
    ).toContain('yaptirimKaynakKosulu(');
  });

  it('ban-enforcer valfi çağırıyor', () => {
    expect(
      oku('lib/ban-enforcer.ts'),
      'ban-enforcer kaynak valfini uygulamıyor: dondurulmuş arşivdeki banlar ' +
        'canlı kick yoluna sızar.',
    ).toContain('yaptirimKaynakKosulu(');
  });
});

describe('süzülmüş liste kendini söylüyor', () => {
  /**
   * Valfin TERS yönlü tuzağı: `altai` kipinde liste neredeyse boş geliyor
   * (bugün aktif panel banı yok). Boş bir ban listesi, "ban yok" ile "liste
   * süzülmüş" arasındaki farkı dosyaya bakan birine söylemiyor — ve bu fark,
   * 20 binden fazla banın sessizce uygulanmaması demek.
   */
  const girdi = {
    entries: [{ steamId: '76561198052840979', eosId: null, reason: 'GEN-1', expiresAt: null }],
    now: new Date('2026-10-25T12:00:00.000Z'),
  };

  it('altai kipinde başlıkta uyarı var', () => {
    const cikti = formatBanList({ ...girdi, kip: 'altai' });
    expect(cikti).toContain('yaptırım kipi: altai');
    expect(cikti).toContain('YALNIZCA panelden');
  });

  it('on kipinde uyarı yok — liste süzülmemiş', () => {
    expect(formatBanList({ ...girdi, kip: 'on' })).not.toContain('DİKKAT');
  });

  it('uyarı ban satırlarını bozmuyor', () => {
    const cikti = formatBanList({ ...girdi, kip: 'altai' });
    // Uyarı satırları yorum (`//`) olduğu için Squad onları yok sayıyor;
    // ban satırı yine okunabilir kalmalı.
    expect(cikti).toContain('76561198052840979:0 //GEN-1');
  });
});
