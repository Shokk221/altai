import { describe, expect, it } from 'vitest';
import { type BanKaydi, gonderiBasligi, gonderiGovdesi } from '../src/ban-postalari.js';

/**
 * Ban kanıt gönderisinin başlığı ve gövdesi.
 *
 * NEDEN TEST EDİLİYOR: eski sistemin aynı kanalda duran gönderilerinden
 * biri `Ban: PZ Höllensturm-{{player.steamID}}` başlığını taşıyor —
 * oyuncunun SteamID'si yokken şablon yer tutucusu ham basılmış. Gönderi
 * başlığı sonradan düzeltilemiyor (kanalda öyle kalıyor) ve bu hata
 * yalnızca kimliksiz oyuncuda ortaya çıktığı için gözle fark edilmesi
 * uzun sürüyor.
 *
 * Aynı yer tutucu hatası ban mesajlarında da iki kez canlıya çıktı
 * (bkz. api/test/ban-sebebi-renderlenir.test.ts).
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
  ...o,
});

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
    const b = gonderiBasligi(kayit({ oyuncuAdi: 'A'.repeat(200) }));
    expect(b.length).toBeLessThanOrEqual(100);
  });
});

describe('gonderiGovdesi', () => {
  it('kalıcı banda süre "kalıcı" yazıyor', () => {
    const g = gonderiGovdesi(kayit(), null);
    expect(g).toContain('**Süre:** kalıcı');
    expect(g).toContain('GEN-1');
    expect(g).toContain('Yalnızkurt');
  });

  it('süreli banda bitiş tarihi yazıyor', () => {
    const g = gonderiGovdesi(kayit({ expiresAt: new Date('2026-11-01T18:30:00.000Z') }), null);
    expect(g).toContain('2026-11-01 18:30 UTC');
  });

  it('SL ban gövdesi oyundan ban olmadığını söylüyor', () => {
    const g = gonderiGovdesi(kayit({ tur: 'sl' }), null);
    expect(g).toContain('manga lideri olamaz');
    expect(g).not.toContain('**Oyundan ban**');
  });

  it('kanıt istemi her gönderide var', () => {
    expect(gonderiGovdesi(kayit(), null)).toContain('Kanıtı');
  });

  it('panel bağlantısı verilmezse satır hiç yazılmıyor', () => {
    expect(gonderiGovdesi(kayit(), null)).not.toContain('http');
    expect(gonderiGovdesi(kayit(), 'https://panel.altaisquad.com/oyuncular/p1')).toContain(
      'https://panel.altaisquad.com/oyuncular/p1',
    );
  });

  it('kimliksiz oyuncuda kimlik satırı boş kalmıyor', () => {
    const g = gonderiGovdesi(kayit({ steamId: null, eosId: null }), null);
    expect(g).not.toContain('Steam');
    expect(g).not.toContain('EOS');
    expect(g).not.toContain('null');
  });
});
