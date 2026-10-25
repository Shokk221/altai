import { afterEach, describe, expect, it } from 'vitest';
import { BmClient } from '../src/client.js';
import { aynayiYokla, yoklamaRaporu } from '../src/probe.js';
import { MOCK_STEAM_ID, type MockServer, startMockBm } from './mock-bm.js';

/**
 * Uç yoklaması.
 *
 * Yoklamanın tek işi DOĞRU TEŞHİS. Yanlış teşhis, çalışan bir ucu bozuk
 * (ya da bozuk bir ucu çalışıyor) göstererek saatlerce yanlış yerde hata
 * aratır — aracın var olma sebebini tersine çevirir.
 */

let mock: MockServer | null = null;

afterEach(async () => {
  await mock?.close();
  mock = null;
});

function istemci(url: string) {
  return new BmClient({ token: 'test', baseUrl: url, requestsPerSecond: 100 });
}

const durum = (s: Awaited<ReturnType<typeof aynayiYokla>>, ad: string) =>
  s.find((x) => x.ad === ad)?.durum;

describe('aynayiYokla', () => {
  it('her şey çalışırken kritik sorun BİLDİRMEZ', async () => {
    mock = await startMockBm();
    const sonuclar = await aynayiYokla(istemci(mock.url), { steamId: MOCK_STEAM_ID });

    expect(durum(sonuclar, 'token')).toBe('ok');
    expect(durum(sonuclar, 'kimlik-aramasi')).toBe('ok');
    expect(durum(sonuclar, 'eski isimler')).toBe('ok');
    expect(durum(sonuclar, 'notlar')).toBe('ok');
    expect(sonuclar.filter((s) => s.kritik && s.durum !== 'ok')).toEqual([]);
  });

  it('token geçersizse SADECE token’ı bildirir, gerisini denemez', async () => {
    // 401 alındığında her ucu tek tek denemek aynı hatayı altı kez
    // tekrarlar ve asıl sebebi çıktının içinde gizler.
    mock = await startMockBm({ forbidden: ['/players'] });
    const sonuclar = await aynayiYokla(istemci(mock.url), { steamId: MOCK_STEAM_ID });

    expect(sonuclar).toHaveLength(1);
    expect(sonuclar[0]?.ad).toBe('token');
    expect(sonuclar[0]?.durum).toBe('hata');
    expect(sonuclar[0]?.detay).toContain('403');
  });

  it('notlara erişim yoksa bunu KRİTİK olarak bildirir', async () => {
    // Notlar aynanın var olma sebebinin yarısı; gösterim verisi gibi
    // "önemsiz" raporlanması, aboneliğin yetmediğini gizlemek olurdu.
    mock = await startMockBm({ forbidden: ['/relationships/notes'] });
    const sonuclar = await aynayiYokla(istemci(mock.url), { steamId: MOCK_STEAM_ID });

    const not = sonuclar.find((s) => s.ad === 'notlar');
    expect(not?.durum).toBe('hata');
    expect(not?.kritik).toBe(true);
    // Sebebi söylemeli: notlar BM'nin Premium/RCON aboneliğine bağlı.
    expect(not?.detay).toContain('Premium');
  });

  it('ban ucu kapalıysa KRİTİK DEĞİL — ayna çalışmaya devam eder', async () => {
    mock = await startMockBm({ forbidden: ['/bans'] });
    const sonuclar = await aynayiYokla(istemci(mock.url), { steamId: MOCK_STEAM_ID });

    const ban = sonuclar.find((s) => s.ad === 'banlar (gösterim)');
    expect(ban?.durum).toBe('yok');
    expect(ban?.kritik).toBe(false);
    // Kritik uçlar etkilenmedi.
    expect(sonuclar.filter((s) => s.kritik && s.durum !== 'ok')).toEqual([]);
  });

  it('oyuncu çözülemezse alt kaynakları UYDURMA id ile yoklamaz', async () => {
    // Uydurma id 404 döner ve "uç kapalı" gibi görünür — yanlış teşhis.
    mock = await startMockBm({ searchReturnsImposter: true });
    const sonuclar = await aynayiYokla(istemci(mock.url), { steamId: MOCK_STEAM_ID });

    expect(durum(sonuclar, 'kimlik-aramasi')).toBe('yok');
    // Notlar/banlar ayrı ayrı yoklanmadı; tek bir "yoklanamadı" satırı var.
    expect(sonuclar.some((s) => s.ad === 'notlar')).toBe(false);
    expect(sonuclar.at(-1)?.detay).toContain('çözülemediği');
  });

  it('kimlik bulunamadığında ne yapılacağını SÖYLER', async () => {
    // Çıktı "eşleşme yok" demekle kalırsa kullanıcı nereye bakacağını
    // bilemez; teşhisin yanında eylem olmalı.
    mock = await startMockBm({ searchReturnsImposter: true });
    const sonuclar = await aynayiYokla(istemci(mock.url), { steamId: MOCK_STEAM_ID });
    expect(sonuclar.find((s) => s.ad === 'kimlik-aramasi')?.detay).toContain('filter[search]');
  });
});

describe('yoklamaRaporu', () => {
  it('kritik sorun yoksa onay satırı basar', async () => {
    mock = await startMockBm();
    const rapor = yoklamaRaporu(await aynayiYokla(istemci(mock.url), { steamId: MOCK_STEAM_ID }));
    expect(rapor.join('\n')).toContain('Kritik uçların hepsi çalışıyor');
  });

  it('kritik sorunu ADIYLA sayar', async () => {
    mock = await startMockBm({ forbidden: ['/relationships/notes'] });
    const rapor = yoklamaRaporu(
      await aynayiYokla(istemci(mock.url), { steamId: MOCK_STEAM_ID }),
    ).join('\n');
    expect(rapor).toContain('1 kritik uç sorunlu');
    expect(rapor).toContain('notlar');
  });

  it('gösterim sorunları kritik sayılmaz', async () => {
    mock = await startMockBm({ forbidden: ['/bans'] });
    const rapor = yoklamaRaporu(
      await aynayiYokla(istemci(mock.url), { steamId: MOCK_STEAM_ID }),
    ).join('\n');
    expect(rapor).toContain('Kritik uçların hepsi çalışıyor');
  });
});
