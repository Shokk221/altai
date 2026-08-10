import { describe, expect, it } from 'vitest';
import { degisimKarari } from '../src/lib/team-change.js';

/**
 * Maç sonunda bekleyen değişimin uygulanıp uygulanmayacağı.
 *
 * Squad'ın komutu hedef takım ALMIYOR, yalnızca "diğer tarafa geçir"
 * diyor. Bu yüzden kararı üst katman veriyor: oyuncu istenen takımda
 * değilse komut gider, oradaysa hiç gitmez. Yanlış karar oyuncuyu tam
 * ters yöne atar ve bu sessizdir — kimse panelin hata yaptığını
 * anlamaz, "oyun saçmaladı" diye geçilir.
 */

describe('hedefli kayıt', () => {
  it('oyuncu hedef takımda değilse uygular', () => {
    expect(degisimKarari('2', '1', { teamId: 1 })).toBe('uygula');
  });

  it('oyuncu zaten hedef takımdaysa dokunmaz', () => {
    // Komut göndermek onu hedeften ÇIKARIRDI.
    expect(degisimKarari('2', '1', { teamId: 2 })).toBe('zaten_hedefte');
  });

  it('aynı kaydı iki kez işlemek zarar vermez', () => {
    // Birinci geçiş uygular, ikincisinde oyuncu hedefte olduğu için durur.
    expect(degisimKarari('1', '2', { teamId: 2 })).toBe('uygula');
    expect(degisimKarari('1', '2', { teamId: 1 })).toBe('zaten_hedefte');
  });

  it('oyuncu sunucudan çıkmışsa uygulamaz', () => {
    expect(degisimKarari('2', '1', undefined)).toBe('oyuncu_yok');
  });

  it('oyuncunun takımı okunamıyorsa yine de uygular', () => {
    // Yetkilinin kararını eksik bilgi yüzünden düşürmek, verilen sözü
    // tutmamak olurdu.
    expect(degisimKarari('2', '1', { teamId: null })).toBe('uygula');
  });
});

describe('hedefsiz eski kayıt', () => {
  // target_team sütunu eklenmeden önce açılmış kayıtlar; kuyrukta
  // bekleyen bir söz şema değişti diye düşmemeli.
  it('oyuncu hâlâ eski takımındaysa uygular', () => {
    expect(degisimKarari(null, '1', { teamId: 1 })).toBe('uygula');
  });

  it('oyuncu bu arada karşıya geçtiyse uygulamaz — geri getirirdi', () => {
    expect(degisimKarari(null, '1', { teamId: 2 })).toBe('zaten_karsida');
  });

  it('istek anındaki takım da bilinmiyorsa uygular', () => {
    expect(degisimKarari(null, null, { teamId: 2 })).toBe('uygula');
  });
});
