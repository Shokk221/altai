import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  panelKomutIzleriniSifirla,
  panelKomutuIsaretle,
  panelKomutuMu,
} from '../src/lib/panel-komut-izi.js';

/**
 * Panelden gönderilen komutun oyundan gelen yankısını ayırt etme.
 *
 * Bu kilitlenmezse tek bir uyarı sistem günlüğüne iki kez düşer ve
 * "bugün kaç uyarı verildi" sorusunun cevabı sessizce iki katına çıkar.
 */

beforeEach(() => {
  panelKomutIzleriniSifirla();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('panel komut izi', () => {
  it('panelin gönderdiği komutun yankısını tanır', () => {
    panelKomutuIsaretle('squad-01', 'warn', 'Mrkosak');
    expect(panelKomutuMu('squad-01', 'warn', 'Mrkosak')).toBe(true);
  });

  it('izi tüketir — ikinci yankı artık panelin sayılmaz', () => {
    panelKomutuIsaretle('squad-01', 'kick', 'Berkay');
    expect(panelKomutuMu('squad-01', 'kick', 'Berkay')).toBe(true);
    expect(panelKomutuMu('squad-01', 'kick', 'Berkay')).toBe(false);
  });

  it('oyun içinden yapılan işlemi panelinki sanmaz', () => {
    expect(panelKomutuMu('squad-01', 'warn', 'BaskaOyuncu')).toBe(false);
  });

  it('işlem türü farklıysa eşleşmez', () => {
    panelKomutuIsaretle('squad-01', 'warn', 'Mrkosak');
    expect(panelKomutuMu('squad-01', 'kick', 'Mrkosak')).toBe(false);
  });

  it('sunucu farklıysa eşleşmez', () => {
    panelKomutuIsaretle('squad-01', 'warn', 'Mrkosak');
    expect(panelKomutuMu('squad-02', 'warn', 'Mrkosak')).toBe(false);
  });

  it('isimde büyük/küçük harf ve boşluk farkını yok sayar', () => {
    panelKomutuIsaretle('squad-01', 'warn', '  MrKosak ');
    expect(panelKomutuMu('squad-01', 'warn', 'mrkosak')).toBe(true);
  });

  it('pencere geçtikten sonra eşleşmez — ilgisiz bir işlem olmalı', () => {
    panelKomutuIsaretle('squad-01', 'warn', 'Mrkosak');
    vi.advanceTimersByTime(21_000);
    expect(panelKomutuMu('squad-01', 'warn', 'Mrkosak')).toBe(false);
  });

  it('isim bilinmiyorsa iz bırakmaz ve eşleştirmez', () => {
    panelKomutuIsaretle('squad-01', 'warn', null);
    expect(panelKomutuMu('squad-01', 'warn', null)).toBe(false);
  });
});

/**
 * Duyuruda anahtar oyuncu adı değil MESAJ.
 *
 * Duyurunun hedef oyuncusu yok; isimle eşleştirmeye kalksaydık anahtar
 * her zaman null olur, hiçbir yankı tanınmaz ve panelden gönderilen her
 * duyuru günlüğe iki kez düşerdi.
 */
describe('duyuru izi', () => {
  it('panelin gönderdiği duyurunun yankısını mesajla tanır', () => {
    panelKomutuIsaretle('squad-01', 'broadcast', 'Sunucu 5 dakika sonra yeniden başlıyor');
    expect(panelKomutuMu('squad-01', 'broadcast', 'Sunucu 5 dakika sonra yeniden başlıyor')).toBe(
      true,
    );
  });

  it('başka bir metinli duyuruyu panelinki sanmaz', () => {
    // Eklentinin zamanlanmış duyurusu tam da bu sırada geçebilir;
    // günlükte kaybolmamalı.
    panelKomutuIsaretle('squad-01', 'broadcast', 'Sunucu yeniden başlıyor');
    expect(panelKomutuMu('squad-01', 'broadcast', 'Discord: altai.gg')).toBe(false);
  });

  it('aynı metinli uyarı ile duyuru karışmaz', () => {
    panelKomutuIsaretle('squad-01', 'broadcast', 'Kurallara uyun');
    expect(panelKomutuMu('squad-01', 'warn', 'Kurallara uyun')).toBe(false);
    expect(panelKomutuMu('squad-01', 'broadcast', 'Kurallara uyun')).toBe(true);
  });

  it('duyuru izi de tüketiliyor — aynı metni ikinci kez bastırmıyor', () => {
    // Eklenti gerçekten aynı metni yayınlıyor olabilir; tek bir panel
    // komutu sonsuza kadar kalkan olmamalı.
    panelKomutuIsaretle('squad-01', 'broadcast', 'Seed bitti, iyi oyunlar');
    expect(panelKomutuMu('squad-01', 'broadcast', 'Seed bitti, iyi oyunlar')).toBe(true);
    expect(panelKomutuMu('squad-01', 'broadcast', 'Seed bitti, iyi oyunlar')).toBe(false);
  });
});
