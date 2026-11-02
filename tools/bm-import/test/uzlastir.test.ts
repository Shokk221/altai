import { describe, expect, it } from 'vitest';
import { dusurmeKarari, uzlastirmaFarki } from '../src/uzlastir.js';

/**
 * Arşivi BM'nin şu anki hâliyle uzlaştırma kararı.
 *
 * NEDEN BU KADAR TEST: "bizde aktif, BM'de yok -> düşür" adımı toplu ban
 * kalkması üretebilir. Yarım kalmış bir dışa aktarım (ağ koptu, kota
 * doldu, süreç öldü) kısmi bir `bans.ndjson` bırakıyor; onu "BM'nin şu
 * anki hâli" sanmak 21.796 banın tamamını düşürmek demek.
 *
 * Hatanın sessiz olması asıl tehlike: ban düştükten sonra panel de oyun
 * da "ban yok" der, kimse yanlış olduğunu anlamaz. Geri alması ise elle
 * tek tek iştir.
 */

describe('dusurmeKarari', () => {
  it('normal uzlaştırmaya izin veriyor', () => {
    // 21.796 aktif, arşivde 21.800, 40 ban affedilmiş: olağan tablo.
    expect(dusurmeKarari(21_796, 40, 21_800).guvenli).toBe(true);
  });

  it('BOŞ arşivde düşürmeyi reddediyor', () => {
    const k = dusurmeKarari(21_796, 21_796, 0);
    expect(k.guvenli).toBe(false);
    expect(k.gerekce).toContain('boş');
  });

  /**
   * En tehlikeli senaryo: dışa aktarım yarıda kesilmiş. Arşiv "geçerli"
   * görünüyor, yalnızca eksik.
   */
  it('arşiv bizdekinin yarısından küçükse reddediyor', () => {
    const k = dusurmeKarari(21_796, 12_000, 9_000);
    expect(k.guvenli).toBe(false);
    expect(k.gerekce).toContain('yarım kalmış');
  });

  it('tek seferde çok fazla ban düşecekse reddediyor', () => {
    // Arşiv boyutu makul ama düşecek sayı aşırı: bir arıza belirtisi.
    const k = dusurmeKarari(1_000, 500, 1_000);
    expect(k.guvenli).toBe(false);
    expect(k.gerekce).toContain('%50');
  });

  it('sınırda kalan düşürmeye izin veriyor (%20)', () => {
    expect(dusurmeKarari(1_000, 200, 1_000).guvenli).toBe(true);
    expect(dusurmeKarari(1_000, 201, 1_000).guvenli).toBe(false);
  });

  it('bizde aktif ban yoksa karar serbest', () => {
    // Düşürecek bir şey yok; oran hesabı sıfıra bölme olurdu.
    expect(dusurmeKarari(0, 0, 5_000).guvenli).toBe(true);
  });
});

describe('uzlastirmaFarki', () => {
  it('üç kümeyi doğru ayırıyor', () => {
    const f = uzlastirmaFarki(
      ['a', 'b', 'yeni'], // arşiv
      ['a', 'b', 'dusen'], // bizde aktif
      ['a', 'b', 'dusen'], // bizdeki tüm kayıtlar
    );
    expect(f.guncellenecek.sort()).toEqual(['a', 'b']);
    expect(f.yeni).toEqual(['yeni']);
    expect(f.dusecek).toEqual(['dusen']);
  });

  /**
   * Zaten kaldırılmış bir ban arşivde yeniden görünürse "yeni" sayılmamalı:
   * ikinci bir satır açmak aynı banı panelde iki kez gösterirdi.
   */
  it('bizde KALDIRILMIŞ olarak duran kayıt yeni sayılmıyor', () => {
    const f = uzlastirmaFarki(['x'], [], ['x']);
    expect(f.yeni).toEqual([]);
    expect(f.guncellenecek).toEqual(['x']);
  });

  /** Zaten düşmüş ban tekrar düşürülmemeli. */
  it('kaldırılmış ban arşivde yoksa tekrar düşürülmüyor', () => {
    const f = uzlastirmaFarki([], [], ['x']);
    expect(f.dusecek).toEqual([]);
  });

  it('boş arşivde bizdeki tüm aktifler düşecek olarak işaretleniyor', () => {
    // İşaretlenir ama `dusurmeKarari` bunu reddeder — iki adım ayrı.
    const f = uzlastirmaFarki([], ['a', 'b'], ['a', 'b']);
    expect(f.dusecek.sort()).toEqual(['a', 'b']);
    expect(dusurmeKarari(f.bizdekiAktif, f.dusecek.length, f.arsivdeki).guvenli).toBe(false);
  });

  it('sayıları raporluyor', () => {
    const f = uzlastirmaFarki(['a', 'b', 'c'], ['a'], ['a', 'z']);
    expect(f.arsivdeki).toBe(3);
    expect(f.bizdekiAktif).toBe(1);
  });
});
