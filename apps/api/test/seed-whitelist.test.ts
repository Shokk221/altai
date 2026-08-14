import { describe, expect, it } from 'vitest';
import { haftaBasi } from '../src/lib/seed-whitelist.js';

/**
 * Haftalık seed ödülünün hafta sınırı.
 *
 * Eski plugin bu hesabı oyun sunucusunda yapıyordu ve yanlış bir sınır
 * doğrudan ödül kaybı demek: bir gün kayması, cumartesi gece seed yapan
 * oyuncunun süresini bir sonraki haftaya atar ve hedefi ıskalatırdı.
 */

describe('haftaBasi', () => {
  it('hafta Pazar 00:00 başlar', () => {
    // 2026-08-12 Çarşamba -> aynı haftanın Pazar'ı 2026-08-09.
    const bas = haftaBasi(new Date('2026-08-12T15:30:00'));
    expect(bas.getDay()).toBe(0);
    expect(bas.getDate()).toBe(9);
    expect(bas.getHours()).toBe(0);
    expect(bas.getMinutes()).toBe(0);
    expect(bas.getSeconds()).toBe(0);
    expect(bas.getMilliseconds()).toBe(0);
  });

  it('Pazar günü haftanın başı O GÜNDÜR, bir önceki hafta değil', () => {
    // Sınır hatasının klasik yeri: Pazar'ı bir önceki haftaya saymak,
    // Pazar seed yapan herkesin süresini yanlış haftaya yazardı.
    const bas = haftaBasi(new Date('2026-08-09T23:59:59'));
    expect(bas.getDate()).toBe(9);
    expect(bas.getHours()).toBe(0);
  });

  it('Pazar 00:00 tam sınırda kendi haftasına düşer', () => {
    const an = new Date('2026-08-09T00:00:00');
    expect(haftaBasi(an).getTime()).toBe(an.getTime());
  });

  it('Cumartesi hâlâ o haftaya ait', () => {
    // 2026-08-15 Cumartesi -> hafta başı yine 2026-08-09.
    const bas = haftaBasi(new Date('2026-08-15T23:00:00'));
    expect(bas.getDate()).toBe(9);
  });

  it('ay sınırını geçen hafta doğru hesaplanır', () => {
    // 2026-09-01 Salı -> hafta başı 2026-08-30 Pazar.
    const bas = haftaBasi(new Date('2026-09-01T12:00:00'));
    expect(bas.getMonth()).toBe(7); // Ağustos
    expect(bas.getDate()).toBe(30);
  });
});
