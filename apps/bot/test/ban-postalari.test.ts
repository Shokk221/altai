import { describe, expect, it } from 'vitest';
import { type BanKaydi, banGomusu, gonderiBasligi } from '../src/ban-postalari.js';

/**
 * Ban kanıt gönderisinin başlığı ve kartı.
 *
 * NEDEN TEST EDİLİYOR: eski sistemin aynı kanalda duran gönderilerinden
 * biri `Ban: PZ Höllensturm-{{player.steamID}}` başlığını taşıyor —
 * oyuncunun SteamID'si yokken şablon yer tutucusu ham basılmış. Gönderi
 * başlığı sonradan düzeltilemiyor (kanalda öyle kalıyor) ve bu hata
 * yalnızca kimliksiz oyuncuda ortaya çıktığı için gözle fark edilmesi
 * uzun sürüyor.
 *
 * Aynı yer tutucu hatası ban mesajlarında üç kez canlıya çıktı
 * (bkz. api/test/ban-sebebi-renderlenir.test.ts), dördüncüsü de burada
 * yaşandı: ilk sürüm sebebi ham gönderiyordu.
 */

const kayit = (o: Partial<BanKaydi> = {}): BanKaydi => ({
  id: 'b1',
  tur: 'ban',
  oyuncuAdi: 'Osmanweb',
  steamId: '76561198873484318',
  eosId: null,
  reason: 'GEN-1 · Küfür, hakaret',
  expiresAt: null,
  verenAd: 'Yalnızkurt',
  olusturuldu: new Date('2026-10-25T21:00:00.000Z'),
  ...o,
});

const SIMDI = new Date('2026-10-25T21:00:00.000Z');
const alan = (g: ReturnType<typeof banGomusu>, ad: string) =>
  g.fields?.find((f) => f.name === ad)?.value;

describe('gonderiBasligi', () => {
  it('eski sistemin biçimini koruyor: Ban: ad-steamid', () => {
    expect(gonderiBasligi(kayit())).toBe('Ban: Osmanweb-76561198873484318');
  });

  it('SL ban ayrı önek alıyor', () => {
    expect(gonderiBasligi(kayit({ tur: 'sl', oyuncuAdi: 'FHP_Reddeogon', steamId: null }))).toBe(
      'SL Ban: FHP_Reddeogon',
    );
  });

  it('SteamID yoksa EOS kimliğine düşüyor', () => {
    const b = gonderiBasligi(kayit({ steamId: null, eosId: '0002bdd708da4ecfb3bd12a1ac04fd36' }));
    expect(b).toBe('Ban: Osmanweb-0002bdd708da4ecfb3bd12a1ac04fd36');
  });

  it('HİÇBİR kimlik yoksa yer tutucu basmıyor — eski sistemin hatası', () => {
    const b = gonderiBasligi(kayit({ oyuncuAdi: 'PZ Höllensturm', steamId: null, eosId: null }));
    expect(b).toBe('Ban: PZ Höllensturm');
    expect(b).not.toContain('{{');
    expect(b).not.toContain('undefined');
    expect(b).not.toContain('null');
  });

  it('boş isim başlığı bozmuyor', () => {
    expect(gonderiBasligi(kayit({ oyuncuAdi: '   ', steamId: null, eosId: null }))).toBe(
      'Ban: bilinmeyen oyuncu',
    );
  });

  // Discord thread adı 100 karakterle sınırlı; aşarsa istek reddedilir ve
  // gönderi hiç açılmaz, yani ban kanıtsız kalır.
  it('100 karakteri aşmıyor', () => {
    expect(gonderiBasligi(kayit({ oyuncuAdi: 'A'.repeat(200) })).length).toBeLessThanOrEqual(100);
  });
});

describe('banGomusu', () => {
  it('oyun banının başlığı sadece "Ban"', () => {
    expect(banGomusu(kayit(), null, SIMDI).title).toBe('Ban');
  });

  it('SL ban başlığı "SL Ban" ve açıklama cümlesi YOK', () => {
    const g = banGomusu(kayit({ tur: 'sl' }), null, SIMDI);
    expect(g.title).toBe('SL Ban');
    // Kart kendini anlatan cümleler yazmıyor; başlık ve renk yeterli.
    expect(JSON.stringify(g)).not.toContain('manga lideri olamaz');
    expect(JSON.stringify(g)).not.toContain('sunucuda kalır');
  });

  it('iki tür farklı renkte', () => {
    expect(banGomusu(kayit(), null, SIMDI).color).not.toBe(
      banGomusu(kayit({ tur: 'sl' }), null, SIMDI).color,
    );
  });

  it('sebep kartın gövdesinde', () => {
    expect(banGomusu(kayit(), null, SIMDI).description).toContain('GEN-1');
  });

  it('oyuncu, süre ve atan alan olarak duruyor', () => {
    const g = banGomusu(kayit(), null, SIMDI);
    expect(alan(g, 'Oyuncu')).toBe('Osmanweb');
    expect(alan(g, 'Süre')).toBe('kalıcı');
    expect(alan(g, 'Atan')).toBe('Yalnızkurt');
  });

  it('süreli banda bitiş tarihi yazıyor', () => {
    const g = banGomusu(kayit({ expiresAt: new Date('2026-11-01T18:30:00.000Z') }), null, SIMDI);
    expect(alan(g, 'Süre')).toContain('2026-11-01 18:30');
  });

  // render.ts ile aynı kural: bilinmeyen değer için alan eklemiyoruz,
  // çünkü yer kaplıyor ama bir şey söylemiyor.
  it('atan bilinmiyorsa alan hiç eklenmiyor', () => {
    expect(alan(banGomusu(kayit({ verenAd: null }), null, SIMDI), 'Atan')).toBeUndefined();
  });

  it('kimliksiz oyuncuda kimlik alanı hiç eklenmiyor', () => {
    const g = banGomusu(kayit({ steamId: null, eosId: null }), null, SIMDI);
    expect(alan(g, 'Kimlikler')).toBeUndefined();
    expect(JSON.stringify(g)).not.toContain('null');
  });

  it('panel bağlantısı başlığı tıklanabilir yapıyor', () => {
    expect(banGomusu(kayit(), null, SIMDI).url).toBeUndefined();
    expect(banGomusu(kayit(), 'https://panel.altaisquad.com/oyuncular/p1', SIMDI).url).toBe(
      'https://panel.altaisquad.com/oyuncular/p1',
    );
  });

  it('kanıt istemi altbilgide', () => {
    expect(banGomusu(kayit(), null, SIMDI).footer?.text).toContain('Kanıtı');
  });
});

describe('sebepteki yer tutucular', () => {
  /**
   * CANLIDA YAŞANDI. İlk sürüm sebebi HAM gönderiyordu ve Discord'a
   * `**Sebep:** GEN-6 · … · Bitiş: {{expires}}` düştü. Veritabanındaki
   * sebep metni bu yer tutucuyu taşıyor (ban listesi üretilirken
   * dolduruluyor); gönderiyi yazan yol da doldurmak zorunda.
   */
  it('{{expires}} yerine gerçek tarih yazıyor', () => {
    const g = banGomusu(
      kayit({
        reason: 'GEN-6 · Reklam yapma · Bitiş: {{expires}}',
        expiresAt: new Date('2026-11-01T20:37:00.000Z'),
      }),
      null,
      SIMDI,
    );
    expect(g.description).not.toContain('{{');
    expect(g.description).toContain('2026-11-01 20:37');
  });

  it('{{timeLeft}} yerine kalan süre yazıyor', () => {
    const g = banGomusu(
      kayit({ reason: 'Kalan: {{timeLeft}}', expiresAt: new Date('2026-10-28T21:00:00.000Z') }),
      null,
      SIMDI,
    );
    expect(g.description).not.toContain('{{');
    expect(g.description).toContain('3 gün');
  });

  it('kalıcı banda yer tutucu "kalıcı" oluyor', () => {
    const g = banGomusu(kayit({ reason: 'Hile · Bitiş: {{expires}}' }), null, SIMDI);
    expect(g.description).not.toContain('{{');
    expect(g.description).toContain('kalıcı');
  });

  // Discord'da 180 karaktere kırpmanın sebebi yok: kanıt gönderisinde
  // sebebin yarısını göstermek yetkilinin aradığı bilgiyi gizler.
  it('uzun sebep ban listesi sınırına kırpılmıyor', () => {
    const uzun = `A${'b'.repeat(300)}`;
    expect(banGomusu(kayit({ reason: uzun }), null, SIMDI).description).toContain(uzun);
  });
});
