import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Oyuna giden ban sebebi HER YOLDA renderlenmeli.
 *
 * NEDEN KAYNAK TARAYAN BİR TEST: bu hata iki kez canlıya çıktı ve
 * ikisinde de oyuncunun ekran görüntüsüyle öğrenildi. Sebep metni
 * veritabanında yer tutucu taşıyor ("… · Bitiş: {{expires}}") ve oyuna
 * sebep gönderen ÜÇ ayrı yol var:
 *
 *   1. ban listesi (.cfg) üretimi      — lib/ban-list-format.ts
 *   2. periyodik RCON kicki            — lib/ban-enforcer.ts
 *   3. ban atıldığı andaki anlık kick  — routes/moderation.ts
 *
 * `renderReason`'ın kendisi doğruydu; ATLANAN ŞEY ÇAĞRI YERİYDİ. Önce
 * (2), sonra (3) unutulmuştu. Davranış testi bunu yakalamıyor: her yol
 * ayrı bir satır, hiçbiri patlamıyor, hata yalnızca oyuncunun ban
 * ekranında görünüyor.
 *
 * SINIRI AÇIK: bu test metin arıyor, davranış ölçmüyor. Üç bilinen yolu
 * koruyor; dördüncü bir yol eklenirse onu yakalamaz. O yüzden her
 * iddianın yanında ne yapılması gerektiği yazıyor.
 */

const KOK = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const oku = (kisa: string) => readFileSync(join(KOK, kisa), 'utf8');

/** `cagri(` ile başlayan bloğun argümanlarını kabaca alır. */
function argumanlar(metin: string, cagri: string): string[] {
  const bulunan: string[] = [];
  let i = metin.indexOf(`${cagri}(`);
  while (i !== -1) {
    const bas = i + cagri.length + 1;
    let derinlik = 1;
    let j = bas;
    while (j < metin.length && derinlik > 0) {
      if (metin[j] === '(') derinlik += 1;
      else if (metin[j] === ')') derinlik -= 1;
      j += 1;
    }
    bulunan.push(metin.slice(bas, j - 1));
    i = metin.indexOf(`${cagri}(`, j);
  }
  return bulunan;
}

const NASIL = [
  '',
  'Sebep metni "{{expires}}" / "{{timeLeft}}" yer tutucuları taşıyor;',
  'ham gidince oyuncu ban ekranında süslü parantez okuyor.',
  'Çözüm: renderReason(reason, expiresAt, new Date()) ile gönderin.',
].join('\n');

describe('oyuna giden ban sebebi renderleniyor', () => {
  it('ban atıldığı andaki anlık kick renderlenmiş sebep alıyor', () => {
    // routes/moderation.ts → oyuncuyuAt(...) ikinci argümanı oyuncunun
    // ban ekranına doğrudan yazılıyor.
    const cagrilar = argumanlar(oku('routes/moderation.ts'), 'oyuncuyuAt')
      // Fonksiyonun KENDİ TANIMI da eşleşiyor; onda renderReason
      // olmaması normal. Tip açıklaması yalnızca imzada bulunuyor.
      .filter((a) => !/:\s*string\b/.test(a));
    expect(
      cagrilar.length,
      'oyuncuyuAt çağrısı bulunamadı — test eskimiş olabilir',
    ).toBeGreaterThan(0);
    for (const a of cagrilar) {
      expect(a, `anlık kick ham sebep gönderiyor.${NASIL}`).toMatch(/renderReason\(/);
    }
  });

  it('periyodik ban kicki renderlenmiş sebep alıyor', () => {
    const metin = oku('lib/ban-enforcer.ts');
    // `kickSebebi` renderReason'ı sarmalıyor; kick onu kullanmalı.
    expect(metin, `kickSebebi renderReason kullanmıyor.${NASIL}`).toMatch(
      /kickSebebi[\s\S]{0,400}?renderReason\(/,
    );
    const kickler = argumanlar(metin, 'komutGonder').filter((a) => /'kick'/.test(a));
    expect(kickler.length, 'ban-enforcer kick çağrısı bulunamadı').toBeGreaterThan(0);
    for (const a of kickler) {
      expect(a, `periyodik kick ham sebep gönderiyor.${NASIL}`).toMatch(/reason:\s*sebep\b/);
    }
  });

  it('ban listesi (.cfg) renderlenmiş sebep yazıyor', () => {
    const metin = oku('lib/ban-list-format.ts');
    expect(metin, `formatBanList renderReason kullanmıyor.${NASIL}`).toMatch(
      /formatBanList[\s\S]*?renderReason\(/,
    );
  });
});
