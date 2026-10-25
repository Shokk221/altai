import { afterEach, describe, expect, it } from 'vitest';
import { BmClient } from '../src/client.js';
import {
  type BmIsim,
  bmOyuncuAynasi,
  bmOyuncuBul,
  eslesenOyuncuId,
  isimBirlestir,
} from '../src/player.js';
import { MOCK_BM_PLAYER_ID, MOCK_STEAM_ID, type MockServer, startMockBm } from './mock-bm.js';

let mock: MockServer | null = null;

afterEach(async () => {
  await mock?.close();
  mock = null;
});

function istemci(url: string) {
  // Hız limiti testte anlamsız: 100 rps ile limiter pratikte devre dışı.
  return new BmClient({ token: 'test', baseUrl: url, requestsPerSecond: 100 });
}

/**
 * Aynanın güvenlik kilidi.
 *
 * BM'nin arama filtresi isme de bakıyor. Dönen ilk sonucu kabul etmek,
 * BAŞKA bir oyuncunun notlarını ve banlarını bizim oyuncumuzun profiline
 * yazmak olurdu — moderatör o notlara bakıp ban kararı veriyor, yani bu
 * hata doğrudan yanlış yaptırıma dönüşür.
 */
describe('eslesenOyuncuId', () => {
  const oyuncu = (id: string) => ({ type: 'player', id });
  const kimlik = (id: string, playerId: string, deger: string) => ({
    type: 'identifier',
    id,
    attributes: { type: 'steamID', identifier: deger },
    relationships: { player: { data: { type: 'player', id: playerId } } },
  });

  it('kimliği TAM eşleşen oyuncuyu döndürür', () => {
    const eslesme = eslesenOyuncuId(
      [oyuncu('42')],
      [kimlik('i-1', '42', MOCK_STEAM_ID)],
      MOCK_STEAM_ID,
    );
    expect(eslesme).toBe('42');
  });

  it('isim üzerinden eşleşen ama kimliği TUTMAYAN oyuncuyu REDDEDER', () => {
    // Aradığımız rakamlar adında geçiyor; kimliği farklı. Kabul edilirse
    // yanlış oyuncunun sicili bizim profile yazılır.
    const eslesme = eslesenOyuncuId(
      [oyuncu('9999')],
      [kimlik('i-9', '9999', '76561198999999999')],
      MOCK_STEAM_ID,
    );
    expect(eslesme).toBeNull();
  });

  it('kimlik eşleşse bile sonuç listesinde olmayan oyuncuyu reddeder', () => {
    // included, data'da olmayan kayıtlar da taşıyabiliyor; o kayda
    // dayanarak oyuncu bağlamak yanlış olurdu.
    const eslesme = eslesenOyuncuId(
      [oyuncu('42')],
      [kimlik('i-7', '777', MOCK_STEAM_ID)],
      MOCK_STEAM_ID,
    );
    expect(eslesme).toBeNull();
  });

  it('EOS kimliğini büyük/küçük harfe bakmadan eşleştirir', () => {
    // EOS id'leri onaltılık ve BM bazı uçlarda büyük harf döndürüyor.
    const eos = 'ABCDEF0123456789abcdef0123456789';
    const eslesme = eslesenOyuncuId([oyuncu('42')], [kimlik('i-1', '42', eos.toUpperCase())], eos);
    expect(eslesme).toBe('42');
  });

  it('hiç kimlik gelmezse null döner', () => {
    expect(eslesenOyuncuId([oyuncu('42')], [], MOCK_STEAM_ID)).toBeNull();
  });
});

describe('isimBirlestir', () => {
  const isim = (name: string, ilk: string | null, son: string | null): BmIsim => ({
    name,
    firstSeen: ilk ? new Date(ilk) : null,
    lastSeen: son ? new Date(son) : null,
    externalId: `${name}-${ilk}`,
  });

  it('aynı ismi tek satıra indirir ve aralığı GENİŞLETİR', () => {
    // BM aynı ismi farklı kayıt kimlikleriyle bildiriyor; arşiv importunda
    // bu 4.064 ismi 9.852 satıra bölmüştü.
    const sonuc = isimBirlestir([
      isim('Ali', '2023-01-01T00:00:00Z', '2023-06-01T00:00:00Z'),
      isim('Ali', '2022-05-01T00:00:00Z', '2023-02-01T00:00:00Z'),
    ]);
    expect(sonuc).toHaveLength(1);
    expect(sonuc[0]?.firstSeen?.toISOString()).toBe('2022-05-01T00:00:00.000Z');
    expect(sonuc[0]?.lastSeen?.toISOString()).toBe('2023-06-01T00:00:00.000Z');
  });

  it('en son kullanılan isim başta döner', () => {
    // Profil ekranı güncel ismi en üstte gösteriyor.
    const sonuc = isimBirlestir([
      isim('Eski', '2020-01-01T00:00:00Z', '2021-01-01T00:00:00Z'),
      isim('Guncel', '2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
    ]);
    expect(sonuc.map((i) => i.name)).toEqual(['Guncel', 'Eski']);
  });

  it('tarihi bilinmeyen kayıt, bilinen aralığı DARALTMAZ', () => {
    // null "tarih yok" demek, "çok eski" demek değil.
    const sonuc = isimBirlestir([
      isim('Ali', '2023-01-01T00:00:00Z', '2023-06-01T00:00:00Z'),
      isim('Ali', null, null),
    ]);
    expect(sonuc[0]?.firstSeen?.toISOString()).toBe('2023-01-01T00:00:00.000Z');
    expect(sonuc[0]?.lastSeen?.toISOString()).toBe('2023-06-01T00:00:00.000Z');
  });
});

describe('bmOyuncuBul', () => {
  it('SteamID’den BM oyuncu id’sini çözer', async () => {
    mock = await startMockBm();
    const id = await bmOyuncuBul(istemci(mock.url), { steamId: MOCK_STEAM_ID });
    expect(id).toBe(MOCK_BM_PLAYER_ID);
  });

  it('isim benzerliğiyle gelen yanlış oyuncuyu bağlamaz', async () => {
    mock = await startMockBm({ searchReturnsImposter: true });
    const id = await bmOyuncuBul(istemci(mock.url), { steamId: MOCK_STEAM_ID });
    expect(id).toBeNull();
  });

  it('403’te fırlatmaz, null döner', async () => {
    // Abonelik planı değiştiğinde bütün panelin çökmesi kabul edilemez.
    mock = await startMockBm({ forbidden: ['/players'] });
    const id = await bmOyuncuBul(istemci(mock.url), { steamId: MOCK_STEAM_ID });
    expect(id).toBeNull();
  });

  it('kimlik verilmezse BM’ye hiç istek atmaz', async () => {
    mock = await startMockBm();
    const id = await bmOyuncuBul(istemci(mock.url), { steamId: null, eosId: null });
    expect(id).toBeNull();
    expect(mock.requests).toHaveLength(0);
  });

  it('sunucu filtresi verildiğinde isteğe eklenir', async () => {
    // Filtresiz arama BM'nin global oyuncu veritabanına gidiyor.
    mock = await startMockBm();
    await bmOyuncuBul(istemci(mock.url), { steamId: MOCK_STEAM_ID }, { serverIds: ['1', '2'] });
    expect(mock.requests[0]).toContain('filter%5Bservers%5D=1%2C2');
  });
});

describe('bmOyuncuAynasi', () => {
  it('isimleri, notları, banları ve süreleri çözer', async () => {
    mock = await startMockBm();
    const veri = await bmOyuncuAynasi(istemci(mock.url), MOCK_BM_PLAYER_ID);

    // İsimler: 3 kayıt, 2 farklı isim (biri ikilenmiş).
    expect(veri.isimler.map((i) => i.name)).toEqual(['YeniIsim', 'EskiIsim']);

    // Not: boş gövdeli olan taşınmadı, yazar adı ilişkiden çözüldü.
    expect(veri.notlar).toHaveLength(1);
    expect(veri.notlar[0]?.body).toBe('Tek kullanımlık hesap şüphesi');
    expect(veri.notlar[0]?.authorName).toBe('ModeratorAli');

    // Ban: atan admin ve ban listesi adı ilişkilerden geldi, süresiz ban
    // null expiresAt olarak durdu.
    expect(veri.banlar).toHaveLength(1);
    expect(veri.banlar[0]?.issuedByName).toBe('AdminVeli');
    expect(veri.banlar[0]?.banListName).toBe('Altai Ana Liste');
    expect(veri.banlar[0]?.expiresAt).toBeNull();

    expect(veri.erisilemeyen).toEqual([]);
  });

  it('süreyi included meta’sından VE oyuncu ilişkisinden okur', async () => {
    // BM ikisini de kullanıyor; tek yola bakmak panelde "0 saat" gösterirdi.
    mock = await startMockBm();
    const veri = await bmOyuncuAynasi(istemci(mock.url), MOCK_BM_PLAYER_ID);
    const sureler = Object.fromEntries(veri.sunucular.map((s) => [s.bmServerId, s.timePlayed]));
    expect(sureler['27133078']).toBe(360_000); // included meta
    expect(sureler['28022344']).toBe(7_200); // ilişki meta'sı (yedek yol)
  });

  it('notlara erişim yoksa fırlatmaz, EKSİK olduğunu bildirir', async () => {
    // "Notu yok" ile "notları okuyamadık" ayrı şeyler. Karıştırmak aynayı
    // sessizce eksik gösterirdi.
    mock = await startMockBm({ forbidden: ['/relationships/notes'] });
    const veri = await bmOyuncuAynasi(istemci(mock.url), MOCK_BM_PLAYER_ID);
    expect(veri.notlar).toEqual([]);
    expect(veri.erisilemeyen).toContain('notlar');
    // Diğer kaynaklar etkilenmedi.
    expect(veri.isimler.length).toBeGreaterThan(0);
    expect(veri.banlar).toHaveLength(1);
  });

  it('banlara erişim yoksa bunu da bildirir', async () => {
    mock = await startMockBm({ forbidden: ['/bans'] });
    const veri = await bmOyuncuAynasi(istemci(mock.url), MOCK_BM_PLAYER_ID);
    expect(veri.banlar).toEqual([]);
    expect(veri.erisilemeyen).toContain('banlar');
  });
});
