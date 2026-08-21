import { describe, expect, it } from 'vitest';
import { kameraKapanisZamani } from '../src/lib/persistence-writer.js';

/**
 * Açık kalmış kamera oturumunun kapanış zamanı.
 *
 * Oyun oturumlarında bu hesap bir kez YANLIŞ yazıldı: üst sınır tek başına
 * uygulanınca 30 dakikalık bir oturum 4 saate şişiyor ve `left_at`
 * GELECEĞE yazılıyordu. Aynı hatayı kamera tarafında tekrarlamamak için
 * kural burada kilitleniyor — üstelik kamera süresi denetimde kullanılıyor,
 * yani şişmiş bir süre doğrudan bir yetkiliyi haksız yere zan altında
 * bırakır.
 */

const SAAT = 60 * 60 * 1000;

describe('kameraKapanisZamani', () => {
  it('kısa oturumu ŞU ANLA kapatır, sınırla değil', () => {
    const simdi = new Date('2026-08-20T12:00:00.000Z');
    const girdi = new Date(simdi.getTime() - 5 * 60 * 1000); // 5 dk önce

    // Sınır (girdi + 1 saat) gelecekte; kullanılırsa 5 dakikalık oturum
    // 1 saat görünürdü.
    expect(kameraKapanisZamani(girdi, simdi)).toEqual(simdi);
  });

  it('uzun oturumu ÜST SINIRLA kapatır', () => {
    const simdi = new Date('2026-08-20T12:00:00.000Z');
    const girdi = new Date(simdi.getTime() - 9 * SAAT);

    // Agent 9 saat önce çökmüş olabilir; o kişiye 9 saat kamera süresi
    // yazmak, gerçekte olmayan bir kullanımı kayda geçirmek olurdu.
    expect(kameraKapanisZamani(girdi, simdi)).toEqual(new Date(girdi.getTime() + SAAT));
  });

  it('ASLA gelecekte bir zaman üretmez', () => {
    const simdi = new Date('2026-08-20T12:00:00.000Z');
    for (const dakika of [0, 1, 30, 59, 60, 61, 600]) {
      const girdi = new Date(simdi.getTime() - dakika * 60_000);
      expect(kameraKapanisZamani(girdi, simdi).getTime()).toBeLessThanOrEqual(simdi.getTime());
    }
  });

  it('tam sınırdaki oturumda sınırı kullanır', () => {
    const simdi = new Date('2026-08-20T12:00:00.000Z');
    const girdi = new Date(simdi.getTime() - SAAT);
    // Sınır tam şu ana denk geliyor: iki değer de aynı, hangisi seçilirse
    // seçilsin sonuç doğru.
    expect(kameraKapanisZamani(girdi, simdi)).toEqual(simdi);
  });

  it('üst sınır oyun oturumundan KISA', () => {
    // Kamera bir moderasyon aracı; içinde saatler geçirilmiyor. Oyun
    // oturumunun 4 saatlik sınırını buraya uygulamak, çökme sonrası
    // yetkililere dört kat fazla süre yazardı.
    const simdi = new Date('2026-08-20T12:00:00.000Z');
    const girdi = new Date(simdi.getTime() - 4 * SAAT);
    const kapanis = kameraKapanisZamani(girdi, simdi);
    expect(kapanis.getTime() - girdi.getTime()).toBe(SAAT);
  });
});
