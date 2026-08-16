import { describe, expect, it } from 'vitest';
import { dengeBozuluyorMu } from '../src/plugins/team-switch.js';

/**
 * Takım değiştirme denge kontrolü.
 *
 * Bu hesap canlı sunucuda oyunculara "hayır" diyor. Fazla gevşek olursa
 * takımlar 10 kişi farkla oynanıyor, fazla sıkı olursa hiç kimse geçemiyor
 * ve komut anlamsızlaşıyor.
 */

describe('dengeBozuluyorMu', () => {
  it('dengeyi DÜZELTEN geçiş her zaman serbest', () => {
    // 45 kişilik taraftan 35 kişilik tarafa geçmek farkı 10'dan 8'e indirir.
    expect(dengeBozuluyorMu(45, 35, 3)).toBe(false);
  });

  it('eşit takımlarda tek geçiş serbest (fark 2, eşik 3)', () => {
    expect(dengeBozuluyorMu(40, 40, 3)).toBe(false);
  });

  it('eşiği AŞAN geçiş reddedilir', () => {
    // 40-38 iken 38'den 40'a geçmek 37-41 yapar: fark 4 > 3.
    expect(dengeBozuluyorMu(38, 40, 3)).toBe(true);
  });

  it('tam eşikte geçiş serbest', () => {
    // 39-38 -> 38-39... fark 1. Sınır davranışı: eşiğe EŞİT olan geçer.
    expect(dengeBozuluyorMu(40, 39, 3)).toBe(false);
  });

  it('eşik 0 iken farkı büyüten hiçbir geçiş olmaz', () => {
    expect(dengeBozuluyorMu(40, 40, 0)).toBe(true);
  });

  it('eşik 0 iken bile dengeyi düzelten geçiş serbest', () => {
    // Kural "farkı büyütme" — küçültmek her zaman kabul.
    expect(dengeBozuluyorMu(42, 38, 0)).toBe(false);
  });

  it('boş sunucuda geçiş engellenmez', () => {
    expect(dengeBozuluyorMu(1, 0, 3)).toBe(false);
  });
});
