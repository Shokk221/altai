import { describe, expect, it } from 'vitest';
import { steamIdAyristir } from '../src/lib/clans.js';

/**
 * Klan üyeliği SteamID listesiyle yönetiliyor ve liste ELLE derleniyor:
 * profil bağlantıları, virgüller, tekrarlar, yanlış yazımlar. Ayrıştırma
 * toleranslı ama sessiz değil — alınmayan kimlik görünmezse listenin
 * yarısı eksik girip kimse fark etmez.
 */

describe('steamIdAyristir', () => {
  it('satır sonuyla ayrılmış listeyi okur', () => {
    const r = steamIdAyristir('76561190000000001\n76561190000000002');
    expect(r.gecerli).toEqual(['76561190000000001', '76561190000000002']);
    expect(r.gecersiz).toEqual([]);
  });

  it('virgül, noktalı virgül ve boşluk da ayraç', () => {
    const r = steamIdAyristir('76561190000000001, 76561190000000002; 76561190000000003');
    expect(r.gecerli).toHaveLength(3);
  });

  it('Steam profil bağlantısından kimliği çıkarır', () => {
    // Yöneticiler genellikle profil URL'si kopyalıyor.
    const r = steamIdAyristir('https://steamcommunity.com/profiles/76561190000000001/');
    expect(r.gecerli).toEqual(['76561190000000001']);
  });

  it('tekrarlar teke iner', () => {
    const r = steamIdAyristir('76561190000000001 76561190000000001 76561190000000001');
    expect(r.gecerli).toEqual(['76561190000000001']);
  });

  it('geçersiz kimlikler AYRI raporlanır, sessizce yutulmaz', () => {
    const r = steamIdAyristir('76561190000000001\nabc\n123');
    expect(r.gecerli).toEqual(['76561190000000001']);
    expect(r.gecersiz).toEqual(['abc', '123']);
  });

  it('Steam64 olmayan uzun sayı reddedilir', () => {
    // 17 hane ama 7656119 ile başlamıyor: başka bir kimlik türü.
    const r = steamIdAyristir('12345678901234567');
    expect(r.gecerli).toEqual([]);
    expect(r.gecersiz).toEqual(['12345678901234567']);
  });

  it('boş girdi boş sonuç', () => {
    expect(steamIdAyristir('   \n  ')).toEqual({ gecerli: [], gecersiz: [] });
  });

  it('karışık gerçekçi liste', () => {
    const ham = `
      76561190000000001
      https://steamcommunity.com/profiles/76561190000000002
      76561190000000001
      bozukdeger
    `;
    const r = steamIdAyristir(ham);
    expect(r.gecerli).toEqual(['76561190000000001', '76561190000000002']);
    expect(r.gecersiz).toEqual(['bozukdeger']);
  });
});
