import { describe, expect, it } from 'vitest';
import {
  bosIstatistik,
  galibiyetOrani,
  kdOrani,
  oyunIciOzet,
  silahlariTopla,
} from '../src/lib/player-stats.js';

/**
 * İstatistiklerin türetilmiş büyüklükleri.
 *
 * Hepsi sessizce yanlış olabilecek türden: hata vermezler, yalnızca
 * sıralamanın tepesi ya da oyuncunun gördüğü sayı bozulur. K/D'nin sıfıra
 * bölünmesi ve galibiyet oranının bilinmeyen sonuçları kayıp sayması, eski
 * sistemde gerçekten yaşanmış iki hataydı.
 */

describe('K/D oranı', () => {
  it('normal durumda iki basamağa yuvarlar', () => {
    expect(kdOrani(5, 3)).toBe(1.67);
  });

  it('hiç ölmemiş oyuncuda bölme yapmaz, öldürme sayısını verir', () => {
    // Sıfıra bölmek Infinity üretirdi; o değer JSON'da null'a dönüşüp
    // panelde boş görünürdü — oysa "5 öldürme, 0 ölüm" gösterilecek bir şey.
    expect(kdOrani(5, 0)).toBe(5);
    expect(kdOrani(0, 0)).toBe(0);
  });

  it('negatif ölüm sayısını da sıfır gibi ele alır', () => {
    // Veri bozulmasına karşı: negatif bir ölüm sayısı bölme sonucunu
    // NEGATİF yapardı ve o oyuncu sıralamanın en dibine düşerdi.
    expect(kdOrani(4, -2)).toBe(4);
  });
});

describe('galibiyet oranı', () => {
  it('bilinen sonuçlar üzerinden yüzde verir', () => {
    expect(galibiyetOrani(3, 1)).toBe(75);
  });

  it('hiç bilinen sonuç yoksa null — sıfır değil', () => {
    // Sıfır "hep kaybetti" demekti. Beraberlikte ve kazananı bildirmeyen
    // modlarda is_winner null kalıyor ve o satırlar paydaya girmiyor.
    expect(galibiyetOrani(0, 0)).toBeNull();
  });

  it('tek basamak ondalığa yuvarlar', () => {
    expect(galibiyetOrani(1, 2)).toBe(33.3);
  });
});

describe('silah kırılımı', () => {
  it('maçları toplar ve çoktan aza sıralar', () => {
    const sonuc = silahlariTopla([
      { BP_AK74: 3, BP_RPG7: 1 },
      { BP_AK74: 2, BP_M4: 5 },
    ]);
    expect(sonuc).toEqual([
      { weapon: 'BP_AK74', kills: 5 },
      { weapon: 'BP_M4', kills: 5 },
      { weapon: 'BP_RPG7', kills: 1 },
    ]);
  });

  it('eşitlikte ada göre sıralar — liste her çağrıda aynı', () => {
    // Sırası oynayan bir liste, panelde her yenilemede farklı görünürdü.
    const a = silahlariTopla([{ zeta: 2, alfa: 2 }]);
    const b = silahlariTopla([{ alfa: 2, zeta: 2 }]);
    expect(a).toEqual(b);
    expect(a[0]?.weapon).toBe('alfa');
  });

  it('boş ve geçersiz kayıtları atlar', () => {
    expect(silahlariTopla([null, undefined, {}, { BP_X: 0 }, { BP_Y: Number.NaN }])).toEqual([]);
  });
});

describe('oyun içi özet', () => {
  it('maçı olmayan oyuncuya ne yapması gerektiğini söyler', () => {
    expect(oyunIciOzet(bosIstatistik())).toContain('Henüz kayıtlı maçın yok');
  });

  it('K/D önce geliyor — oyuncunun sorduğu ilk şey o', () => {
    const ozet = oyunIciOzet({
      ...bosIstatistik(),
      bulundu: true,
      rounds: 40,
      kills: 120,
      deaths: 60,
      revives: 15,
      bestKillstreak: 7,
      kdr: 2,
      winRate: 55,
    });
    expect(ozet.startsWith('K/D 2')).toBe(true);
    expect(ozet).toContain('120 öldürme');
    expect(ozet).toContain('%55 galibiyet');
    expect(ozet).toContain('40 maç');
  });

  it('galibiyet oranı bilinmiyorsa o parçayı hiç yazmaz', () => {
    const ozet = oyunIciOzet({ ...bosIstatistik(), bulundu: true, rounds: 3, kdr: 1 });
    expect(ozet).not.toContain('galibiyet');
    expect(ozet).toContain('3 maç');
  });
});
