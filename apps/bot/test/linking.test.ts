import { describe, expect, it } from 'vitest';
import { steamIdOku } from '../src/linking.js';

/**
 * SteamID okuma — bağlama komutunun girdi kapısı.
 *
 * Kullanıcı Discord'da elle yazıyor: profil bağlantısı yapıştırıyor,
 * boşluk bırakıyor, yanlış kimlik türü gönderiyor. Yanlış ayrıştırma,
 * yetkinin başka birine bağlanması demek.
 */

describe('steamIdOku', () => {
  it('düz SteamID kabul edilir', () => {
    expect(steamIdOku('76561190000000001')).toBe('76561190000000001');
  });

  it('boşluklar önemsiz', () => {
    expect(steamIdOku('  76561190000000001  ')).toBe('76561190000000001');
  });

  it('profil bağlantısından çıkarılır', () => {
    expect(steamIdOku('https://steamcommunity.com/profiles/76561190000000001/')).toBe(
      '76561190000000001',
    );
  });

  it('Steam64 olmayan uzun sayı reddedilir', () => {
    // 17 hane ama 7656119 ile başlamıyor.
    expect(steamIdOku('12345678901234567')).toBeNull();
  });

  it('kısa sayı reddedilir', () => {
    expect(steamIdOku('7656119')).toBeNull();
  });

  it('özel isimli profil bağlantısı reddedilir', () => {
    // /id/ biçiminde SteamID yok; kabul etmek yanlış hesabı bağlardı.
    expect(steamIdOku('https://steamcommunity.com/id/birisi')).toBeNull();
  });

  it('boş girdi reddedilir', () => {
    expect(steamIdOku('   ')).toBeNull();
  });
});
