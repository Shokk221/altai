import { describe, expect, it } from 'vitest';
import { degisimKarari } from '../src/lib/team-change.js';

/**
 * Maç sonunda bekleyen değişimin uygulanıp uygulanmayacağı.
 *
 * Squad'ın komutu hedef takım ALMIYOR, yalnızca "diğer tarafa geçir"
 * diyor. Yani oyuncu bu arada zaten karşıya geçtiyse komutu çalıştırmak
 * onu GERİ getirir — istenenin tam tersi. Ve bu hata sessizdir: kimse
 * panelin yanlış yaptığını fark etmez, "oyun saçmaladı" diye geçilir.
 */

describe('maç sonu takım değişimi kararı', () => {
  it('oyuncu hâlâ eski takımındaysa uygular', () => {
    expect(degisimKarari('1', { teamId: 1 })).toBe('uygula');
  });

  it('oyuncu bu arada karşıya geçtiyse UYGULAMAZ — geri getirirdi', () => {
    expect(degisimKarari('1', { teamId: 2 })).toBe('zaten_karsida');
  });

  it('oyuncu sunucudan çıkmışsa uygulamaz', () => {
    expect(degisimKarari('1', undefined)).toBe('oyuncu_yok');
  });

  it('istek anındaki takım bilinmiyorsa yine de uygular', () => {
    // Yetkili kararı bilerek verdi; eksik bilgi yüzünden düşürmek
    // verilen sözü tutmamak olurdu.
    expect(degisimKarari(null, { teamId: 2 })).toBe('uygula');
  });

  it('oyuncunun şimdiki takımı okunamıyorsa uygular', () => {
    expect(degisimKarari('1', { teamId: null })).toBe('uygula');
  });
});
