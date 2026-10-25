import { describe, expect, it } from 'vitest';
import { bayatMi } from '../src/lib/bm-sync.js';

/**
 * BM aynasının bayatlık kararı.
 *
 * Burada kilitlenen şey, BM kotasının (dakikada 300 istek) nasıl
 * harcandığı. Karar yanlışsa iki yönde de bozuluyor: fazla gevşek olunca
 * dolu bir sunucuda aynı oyuncular her girişte yeniden sorulup kota
 * yanıyor, fazla sıkı olunca notlar günlerce güncellenmiyor.
 */

const TTL = 24 * 60 * 60 * 1000;
const SIMDI = new Date('2026-10-24T12:00:00Z');

function oncekiSaat(saat: number): Date {
  return new Date(SIMDI.getTime() - saat * 60 * 60 * 1000);
}

describe('bayatMi', () => {
  it('TTL dolmadan başarılı okuma bayat DEĞİL', () => {
    const satir = { syncedAt: oncekiSaat(5), attemptedAt: oncekiSaat(5), status: 'ok' };
    expect(bayatMi(satir, TTL, SIMDI)).toBe(false);
  });

  it('TTL dolduktan sonra bayat', () => {
    const satir = { syncedAt: oncekiSaat(25), attemptedAt: oncekiSaat(25), status: 'ok' };
    expect(bayatMi(satir, TTL, SIMDI)).toBe(true);
  });

  it('tam TTL sınırında bayat sayılır', () => {
    // Sınır dahil: "24 saattir okunmadı" tazelenmesi gereken durumdur.
    const satir = {
      syncedAt: new Date(SIMDI.getTime() - TTL),
      attemptedAt: oncekiSaat(24),
      status: 'ok',
    };
    expect(bayatMi(satir, TTL, SIMDI)).toBe(true);
  });

  it('hiç başarılı okuma yoksa bayat', () => {
    const satir = { syncedAt: null, attemptedAt: oncekiSaat(1), status: 'ok' };
    expect(bayatMi(satir, TTL, SIMDI)).toBe(true);
  });

  it('hata durumu bir saatten önce TEKRAR DENENMEZ', () => {
    // Geçici bir BM kesintisinde her profil açılışında yeniden denemek,
    // kotayı hiçbir karşılığı olmadan yakar.
    const satir = { syncedAt: null, attemptedAt: oncekiSaat(0.5), status: 'hata' };
    expect(bayatMi(satir, TTL, SIMDI)).toBe(false);
  });

  it('hata durumu bir saat sonra tekrar denenir', () => {
    const satir = { syncedAt: null, attemptedAt: oncekiSaat(2), status: 'hata' };
    expect(bayatMi(satir, TTL, SIMDI)).toBe(true);
  });

  it('hata, ESKİ başarılı okuma taze olsa bile yeniden denenebilir', () => {
    // `synced_at` taze ama son deneme hata vermiş: yeniden deneme hakkı
    // `attempted_at`'e bakıyor, yoksa hata kalıcı olarak gizlenirdi.
    const satir = { syncedAt: oncekiSaat(2), attemptedAt: oncekiSaat(2), status: 'hata' };
    expect(bayatMi(satir, TTL, SIMDI)).toBe(true);
  });

  it('BM’de bulunamayan oyuncu 6 saatten önce tekrar SORULMAZ', () => {
    const satir = { syncedAt: null, attemptedAt: oncekiSaat(3), status: 'bulunamadi' };
    expect(bayatMi(satir, TTL, SIMDI)).toBe(false);
  });

  it('BM’de bulunamayan oyuncu 6 saat sonra tekrar sorulur', () => {
    // Yeni bir oyuncunun BM'de indekslenmesi zaman alıyor; "bulunamadı"
    // kalıcı bir cevap değil.
    const satir = { syncedAt: null, attemptedAt: oncekiSaat(7), status: 'bulunamadi' };
    expect(bayatMi(satir, TTL, SIMDI)).toBe(true);
  });

  it('bulunamadi, hata’dan DAHA UZUN bekler', () => {
    // İkisi karışırsa BM'de gerçekten olmayan oyuncular saatlik olarak
    // sorulup kotanın büyük kısmını yer.
    const dortSaat = { syncedAt: null, attemptedAt: oncekiSaat(4), status: 'bulunamadi' };
    const dortSaatHata = { syncedAt: null, attemptedAt: oncekiSaat(4), status: 'hata' };
    expect(bayatMi(dortSaat, TTL, SIMDI)).toBe(false);
    expect(bayatMi(dortSaatHata, TTL, SIMDI)).toBe(true);
  });
});
