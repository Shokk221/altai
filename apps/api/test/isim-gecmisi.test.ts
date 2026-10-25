import { describe, expect, it } from 'vitest';
import { kaydedilecekIsim } from '../src/lib/persistence-writer.js';

/**
 * İsim geçmişine ne yazılır, ne yazılmaz.
 *
 * `player_names` tekilliği (player_id, name) üzerinde ve bu tablo
 * moderasyonda "bu adam 6 ay önce hangi isimle oynuyordu" sorusunun tek
 * cevabı. Kirlenmesi geri alınması zor: aynı ismin iki varyantı, oyuncunun
 * hiç yapmadığı bir isim değişikliği olarak görünür ve admin ona bakıp
 * "isim değiştirip kaçmış" diye karar verir.
 */

describe('kaydedilecekIsim', () => {
  it('normal ismi olduğu gibi kaydeder', () => {
    expect(kaydedilecekIsim('Çağrı')).toBe('Çağrı');
  });

  it('baştaki ve sondaki boşluğu KIRPAR', () => {
    // Kırpılmazsa "Ali" ile "Ali " aynı oyuncunun iki ayrı ismi olur.
    expect(kaydedilecekIsim('  Ali  ')).toBe('Ali');
    expect(kaydedilecekIsim('Ali ')).toBe('Ali');
    expect(kaydedilecekIsim(' Ali')).toBe('Ali');
  });

  it('kırpma sonrası aynı isme varan varyantlar TEK isme iner', () => {
    // Tekilliğin anlamı bu: üç varyant tek satır olmalı.
    const varyantlar = ['Ali', 'Ali ', '  Ali'];
    const sonuc = new Set(varyantlar.map((v) => kaydedilecekIsim(v)));
    expect(sonuc.size).toBe(1);
  });

  it('isim İÇİNDEKİ boşluğa dokunmaz', () => {
    // Klan etiketli isimler böyle: "[ALTAI] Ali". İçeriyi normalize etmek
    // oyuncunun gerçek ismini değiştirmek olurdu.
    expect(kaydedilecekIsim('[ALTAI] Ali')).toBe('[ALTAI] Ali');
  });

  it('boş ismi REDDEDER', () => {
    // Squad bazı girişlerde isim vermiyor; gövdesiz satır profilde boş
    // bir satır olarak görünür ve hiçbir şey anlatmaz.
    expect(kaydedilecekIsim('')).toBeNull();
  });

  it('yalnızca boşluktan oluşan ismi reddeder', () => {
    for (const bos of ['   ', '\t', '\n', ' \t\n ']) {
      expect(kaydedilecekIsim(bos)).toBeNull();
    }
  });

  it('null ve undefined’ı reddeder', () => {
    // Kimlik çözümleme yolu isim taşımıyor; oraya düşen bir çağrı
    // sessizce boş satır yazmamalı.
    expect(kaydedilecekIsim(null)).toBeNull();
    expect(kaydedilecekIsim(undefined)).toBeNull();
  });

  it('tek karakterlik ismi kabul eder', () => {
    // Kısa isim geçerli bir isim; eşik uydurmuyoruz.
    expect(kaydedilecekIsim('x')).toBe('x');
  });
});
