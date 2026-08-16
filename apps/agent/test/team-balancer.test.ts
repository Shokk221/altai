import { describe, expect, it } from 'vitest';
import {
  galibiyetSerisi,
  klanlariBirlestir,
  rakipleriAyir,
  tasinacakMangalar,
} from '../src/plugins/team-balancer.js';

/**
 * Karıştırma kararının iki saf parçası.
 *
 * Bu hesaplar canlı sunucuda 80 kişinin takımını değiştiriyor. Yanlış bir
 * seri sayımı ya da yanlış bir plan, dengeyi düzeltmek yerine bozar ve
 * geri alması elle takım değiştirmekten geçer.
 */

const mac = (winnerTeam: number | null) => ({
  winnerTeam,
  winnerTickets: null,
  loserTickets: null,
});

describe('galibiyetSerisi', () => {
  it('aynı taraf üst üste kazandıysa seriyi sayar', () => {
    expect(galibiyetSerisi([mac(1), mac(1), mac(1), mac(2)])).toEqual({ takim: 1, seri: 3 });
  });

  it('seri ilk farklı sonuçta kırılır', () => {
    expect(galibiyetSerisi([mac(2), mac(1), mac(1)])).toEqual({ takim: 2, seri: 1 });
  });

  it('boş geçmişte seri yok', () => {
    expect(galibiyetSerisi([])).toEqual({ takim: 0, seri: 0 });
  });

  it('en son maçın sonucu BİLİNMİYORSA seri sayılmaz', () => {
    // Sonucu bilinmeyen bir maçı "seri devam etti" saymak, olmayan bir
    // dengesizlik yüzünden takımları karıştırmak olurdu.
    expect(galibiyetSerisi([mac(null), mac(1), mac(1)])).toEqual({ takim: 0, seri: 0 });
  });

  it('aradaki bilinmeyen sonuç seriyi kırar', () => {
    expect(galibiyetSerisi([mac(1), mac(null), mac(1)])).toEqual({ takim: 1, seri: 1 });
  });

  it('tek maçlık geçmişte seri 1', () => {
    expect(galibiyetSerisi([mac(2)])).toEqual({ takim: 2, seri: 1 });
  });
});

describe('tasinacakMangalar', () => {
  const grup = (n: number) => ({ uyeler: Array.from({ length: n }, (_, i) => i) });

  it('hedefe ulaşana kadar manga seçer', () => {
    // 20 oyuncu, %50 -> hedef 10.
    const secilen = tasinacakMangalar([grup(9), grup(6), grup(3), grup(2)], 0.5);
    const toplam = secilen.reduce((n, g) => n + g.uyeler.length, 0);
    expect(toplam).toBeGreaterThanOrEqual(10);
  });

  it('BÜYÜK mangalardan başlar', () => {
    // Küçüklerden başlanırsa hedefe ulaşmak için çok sayıda manga taşınır
    // ve karıştırma "herkes yer değiştirdi" hâline gelir.
    const secilen = tasinacakMangalar([grup(2), grup(9), grup(3)], 0.5);
    expect(secilen[0]?.uyeler.length).toBe(9);
    expect(secilen).toHaveLength(1);
  });

  it('yüzde 100 hepsini seçer', () => {
    const secilen = tasinacakMangalar([grup(4), grup(3)], 1);
    expect(secilen).toHaveLength(2);
  });

  it('boş listede plan boş', () => {
    expect(tasinacakMangalar([], 0.5)).toEqual([]);
  });

  it('tek kişilik gruplar da taşınabilir', () => {
    // Mangasız oyuncular tek kişilik grup olarak geliyor; dengeyi ince
    // ayarlayan tam olarak onlar.
    const secilen = tasinacakMangalar([grup(1), grup(1), grup(1), grup(1)], 0.5);
    expect(secilen).toHaveLength(2);
  });

  it('bir mangalık takımda o manga taşınır', () => {
    const secilen = tasinacakMangalar([grup(8)], 0.5);
    expect(secilen).toHaveLength(1);
  });
});

describe('klanlariBirlestir', () => {
  const uye = (steamId: string) => ({ steamId, eosId: null });

  it('farklı mangalardaki klan üyelerini tek gruba toplar', () => {
    // Ayrı ayrı taşımak klanı ikiye bölerdi.
    const klanlar = new Map([
      ['1', 'ALTAI'],
      ['2', 'ALTAI'],
    ]);
    const sonuc = klanlariBirlestir([{ uyeler: [uye('1')] }, { uyeler: [uye('2')] }], klanlar);
    expect(sonuc).toHaveLength(1);
    expect(sonuc[0]?.uyeler).toHaveLength(2);
    expect(sonuc[0]?.klan).toBe('ALTAI');
  });

  it('klansız gruplar olduğu gibi kalır', () => {
    const sonuc = klanlariBirlestir([{ uyeler: [uye('9')] }], new Map());
    expect(sonuc).toHaveLength(1);
    expect(sonuc[0]?.klan).toBeNull();
  });

  it('ÇOĞUNLUĞU klanlı olmayan manga klana yazılmaz', () => {
    // Karışık bir mangayı bir klana yazmak, o klanın olmayan üyelerini
    // de taşırdı.
    const klanlar = new Map([['1', 'ALTAI']]);
    const sonuc = klanlariBirlestir([{ uyeler: [uye('1'), uye('2'), uye('3')] }], klanlar);
    expect(sonuc[0]?.klan).toBeNull();
  });

  it('çoğunluk klanlıysa manga o klana yazılır', () => {
    const klanlar = new Map([
      ['1', 'ALTAI'],
      ['2', 'ALTAI'],
    ]);
    const sonuc = klanlariBirlestir([{ uyeler: [uye('1'), uye('2'), uye('3')] }], klanlar);
    expect(sonuc[0]?.klan).toBe('ALTAI');
    // Klanlı olmayan üye de klanla birlikte taşınıyor — manga bölünmüyor.
    expect(sonuc[0]?.uyeler).toHaveLength(3);
  });
});

describe('rakipleriAyir', () => {
  it('rakip klanların ikisi birden taşınmaz', () => {
    // İkisi de taşınırsa yine aynı tarafta buluşurlardı.
    const plan = rakipleriAyir(
      [
        { klan: 'OWL', uyeler: [] },
        { klan: 'BADGER', uyeler: [] },
      ],
      [['OWL', 'BADGER']],
    );
    expect(plan).toHaveLength(1);
    expect(plan[0]?.klan).toBe('OWL');
  });

  it('rakip olmayan klanlar etkilenmez', () => {
    const plan = rakipleriAyir(
      [
        { klan: 'OWL', uyeler: [] },
        { klan: 'ALTAI', uyeler: [] },
      ],
      [['OWL', 'BADGER']],
    );
    expect(plan).toHaveLength(2);
  });

  it('klansız gruplar hep planda kalır', () => {
    const plan = rakipleriAyir([{ klan: null, uyeler: [] }], [['OWL', 'BADGER']]);
    expect(plan).toHaveLength(1);
  });

  it('eşleştirme harf duyarsız', () => {
    const plan = rakipleriAyir(
      [
        { klan: 'owl', uyeler: [] },
        { klan: 'BADGER', uyeler: [] },
      ],
      [['OWL', 'badger']],
    );
    expect(plan).toHaveLength(1);
  });

  it('rakip çifti tanımlı değilse plan aynen kalır', () => {
    const plan = rakipleriAyir(
      [
        { klan: 'A', uyeler: [] },
        { klan: 'B', uyeler: [] },
      ],
      [],
    );
    expect(plan).toHaveLength(2);
  });
});
