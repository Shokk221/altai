import { describe, expect, it } from 'vitest';
import { VARSAYILAN_ESIKLER, seviyeEtiketi } from '../src/lib/steam-level-flags.js';

/**
 * Steam seviyesi -> etiket eşlemesi.
 *
 * İstek "3lv altı kırmızı, 5lv altı sarı" idi. Sınırların tam olarak nerede
 * olduğu burada kilitleniyor: bir kayma, seviye 3 olan oyuncuyu kırmızıya
 * boyar ve moderasyon ekranında yanlış bir izlenim yaratır.
 */

describe('seviyeEtiketi', () => {
  it('3’ün ALTI kırmızı etiketi alır', () => {
    for (const seviye of [0, 1, 2]) {
      expect(seviyeEtiketi(seviye)).toBe('Steam Seviyesi < 3');
    }
  });

  it('tam 3 kırmızı DEĞİL, sarı alır', () => {
    // "3lv altı" sınırı dışlayıcı: seviye 3 olan oyuncu eşiği geçmiştir.
    expect(seviyeEtiketi(3)).toBe('Steam Seviyesi < 5');
  });

  it('3 ile 5 arası sarı etiketi alır', () => {
    expect(seviyeEtiketi(3)).toBe('Steam Seviyesi < 5');
    expect(seviyeEtiketi(4)).toBe('Steam Seviyesi < 5');
  });

  it('tam 5 ve üstü etiket ALMAZ', () => {
    for (const seviye of [5, 6, 42, 500]) {
      expect(seviyeEtiketi(seviye)).toBeNull();
    }
  });

  it('düşük seviye YALNIZCA bir etiket alır', () => {
    // 3’ün altındaki hesap 5’in de altında; ikisini birden almamalı,
    // yoksa panelde aynı oyuncuda iki rozet görünür.
    const eslesenler = VARSAYILAN_ESIKLER.filter((e) => 1 < e.altinda);
    expect(eslesenler.length).toBeGreaterThan(1);
    expect(seviyeEtiketi(1)).toBe('Steam Seviyesi < 3');
  });

  it('okunamayan seviye (null) etiket üretmez', () => {
    // Gizli profil kural ihlali değil. "Okunamadı"yı "seviye 0" saymak,
    // profilini kapatmış herkesi en düşük seviyeymiş gibi damgalardı.
    expect(seviyeEtiketi(null)).toBeNull();
  });

  it('eşikler dar olandan geniş olana SIRALI', () => {
    // İlk eşleşen kazandığı için sıra bozulursa seviye 1 olan oyuncu
    // sarı etiket alırdı.
    const sirali = [...VARSAYILAN_ESIKLER].sort((a, b) => a.altinda - b.altinda);
    expect(VARSAYILAN_ESIKLER.map((e) => e.altinda)).toEqual(sirali.map((e) => e.altinda));
  });

  it('etiketlerin rengi tanımlı', () => {
    // Rozetin rengi panelde gösteriliyor; renksiz etiket isteğin yarısını
    // karşılamaz.
    for (const e of VARSAYILAN_ESIKLER) {
      expect(e.renk).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});
