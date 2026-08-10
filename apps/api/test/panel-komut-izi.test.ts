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
