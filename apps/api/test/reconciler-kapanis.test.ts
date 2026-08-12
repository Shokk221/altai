import { describe, expect, it } from 'vitest';
import { reconcilerKapanisZamani } from '../src/lib/persistence-writer.js';

/**
 * Agent çöktüğünde açık kalan session'ların kapanış zamanı.
 *
 * Bu hesap doğrudan oyuncuların toplam oynama süresine yazıyor: seed ödülü,
 * "acemi" eşikleri ve panelin gösterdiği süre hep buradan besleniyor.
 * Yanlış bir kapanış zamanı sessizce yanlış yaptırım demek.
 */

const SAAT = 60 * 60 * 1000;
const simdi = new Date('2026-08-12T12:00:00.000Z');

describe('reconcilerKapanisZamani', () => {
  it('yeni başlamış session ŞU ANDA kapanır — gelecekte değil', () => {
    // Asıl hata buydu: sınır koşulsuz uygulanınca 30 dakika önce başlamış
    // bir session joined_at + 4 saat ile kapanıyor, yani `now()`'dan sonra
    // bir zaman damgasıyla. 30 dakikalık oyun 4 saat olarak kaydediliyordu.
    const joined = new Date(simdi.getTime() - 30 * 60 * 1000);
    expect(reconcilerKapanisZamani(joined, simdi)).toEqual(simdi);
  });

  it('4 saati aşan session sınırda kapanır', () => {
    // Sınırın asıl işi bu: agent günlerce kapalı kaldıysa oyuncuya günlerce
    // oynama süresi yazılmamalı.
    const joined = new Date(simdi.getTime() - 30 * SAAT);
    expect(reconcilerKapanisZamani(joined, simdi)).toEqual(new Date(joined.getTime() + 4 * SAAT));
  });

  it('tam sınırdaki session için sınır geçerli', () => {
    const joined = new Date(simdi.getTime() - 4 * SAAT);
    expect(reconcilerKapanisZamani(joined, simdi)).toEqual(simdi);
  });

  it('kapanış zamanı hiçbir durumda şu andan sonra olamaz', () => {
    for (const dakika of [0, 1, 59, 120, 239, 240, 241, 10_000]) {
      const joined = new Date(simdi.getTime() - dakika * 60_000);
      expect(reconcilerKapanisZamani(joined, simdi).getTime()).toBeLessThanOrEqual(simdi.getTime());
    }
  });

  it('kapanış zamanı hiçbir durumda başlangıçtan önce olamaz', () => {
    // Saat kayması ya da ileri tarihli bir joined_at, negatif süreli bir
    // session üretmemeli.
    const joined = new Date(simdi.getTime() + 5 * 60_000);
    expect(reconcilerKapanisZamani(joined, simdi).getTime()).toBeLessThanOrEqual(simdi.getTime());
  });
});
