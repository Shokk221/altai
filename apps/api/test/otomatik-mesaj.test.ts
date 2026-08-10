import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { otomatikMi, otomatikSayaclariSifirla } from '../src/lib/otomatik-mesaj.js';

/**
 * Eklenti mesajlarının insan uyarılarından ayrılması.
 *
 * Canlıda ölçüldü: bir saatte 454 oyun içi uyarının 289'u üç kalıptan
 * geliyordu ve sistem günlüğünün %65'i eklenti gürültüsüydü. Ayrım
 * bozulursa gerçek bir moderasyon kararı o yığında görünmez olur.
 */

beforeEach(() => {
  otomatikSayaclariSifirla();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const MANGA = 'Lütfen bir mangaya katılın!';

describe('otomatik mesaj ayrımı', () => {
  it('ilk görülen mesajı otomatik saymaz', () => {
    expect(otomatikMi('squad-01', MANGA)).toBe(false);
  });

  it('tekrarlayan mesajı otomatik sayar', () => {
    otomatikMi('squad-01', MANGA);
    otomatikMi('squad-01', MANGA);
    expect(otomatikMi('squad-01', MANGA)).toBe(true);
  });

  it('bir kez yazılan insan uyarısını otomatik saymaz', () => {
    otomatikMi('squad-01', MANGA);
    otomatikMi('squad-01', MANGA);
    otomatikMi('squad-01', MANGA);
    expect(otomatikMi('squad-01', 'küfür etmeyi bırak yoksa ban')).toBe(false);
  });

  it('içindeki sayı değişse de aynı kalıp sayar', () => {
    // "250 saniyeniz kaldı" / "180 saniyeniz kaldı" aynı eklentiden.
    otomatikMi('squad-01', 'Özür dilemek için 250 saniyeniz kaldı!');
    otomatikMi('squad-01', 'Özür dilemek için 180 saniyeniz kaldı!');
    expect(otomatikMi('squad-01', 'Özür dilemek için 90 saniyeniz kaldı!')).toBe(true);
  });

  it('baştaki/sondaki boşluk farkını yok sayar', () => {
    // Kapsam bilerek dar: Türkçe'de 'ı' ve 'i' büyütülünce ikisi de 'I'
    // oluyor, yani bilgi geri döndürülemez biçimde kayboluyor — hiçbir
    // küçültme fonksiyonu 'KATILIN'ı 'katılın'a geri getiremez. Eklenti
    // mesajları zaten her seferinde birebir aynı geldiği için gerçek
    // ihtiyaç boşluk ve basit harf farkı.
    otomatikMi('squad-01', MANGA);
    otomatikMi('squad-01', `  ${MANGA}  `);
    expect(otomatikMi('squad-01', MANGA)).toBe(true);
  });

  it('yalnızca harf büyüklüğü değişen ASCII metni aynı sayar', () => {
    otomatikMi('squad-01', 'Join a squad');
    otomatikMi('squad-01', 'JOIN A SQUAD');
    expect(otomatikMi('squad-01', 'join a squad')).toBe(true);
  });

  it('sunucular ayrı sayılır', () => {
    otomatikMi('squad-01', MANGA);
    otomatikMi('squad-01', MANGA);
    expect(otomatikMi('squad-02', MANGA)).toBe(false);
  });

  it('pencere geçince sayaç sıfırlanır', () => {
    otomatikMi('squad-01', MANGA);
    otomatikMi('squad-01', MANGA);
    vi.advanceTimersByTime(61 * 60 * 1000);
    expect(otomatikMi('squad-01', MANGA)).toBe(false);
  });

  it('boş mesajı otomatik saymaz', () => {
    expect(otomatikMi('squad-01', undefined)).toBe(false);
  });
});
