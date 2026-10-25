import { describe, expect, it } from 'vitest';
import { notSatiri } from '../src/import.js';
import type { BmRecord } from '../src/ndjson.js';

/**
 * Arşivdeki notların hangisi aktarılır, hangisi atlanır.
 *
 * Notlar moderasyon geçmişinin yarısı ve BM'de yıllarca birikti. Bu
 * elemenin sessizce yanlış yapılması iki yönde de pahalı: fazla eleyince
 * notlar hiç gelmez ve kimse fark etmez ("oyuncunun notu yokmuş"), az
 * eleyince oyuncusu çözülemeyen notlar yanlış satırlara ya da hayalet
 * kayıtlara gider.
 */

const PLAYERS = new Map([['bm-1', 'uuid-1']]);
const USERS = new Map([['u-1', 'ModeratorAli']]);

// `_playerId?: string | undefined`: testler damgayı açıkça `undefined`
// vererek "damga yok" durumunu kuruyor; exactOptionalPropertyTypes altında
// bu, salt `?:` ile ifade edilemiyor.
function not(over: Partial<BmRecord> & { _playerId?: string | undefined } = {}) {
  return {
    type: 'playerNote',
    id: 'n-1',
    attributes: { note: 'Şüpheli hesap', createdAt: '2024-03-01T10:00:00.000Z' },
    relationships: { user: { data: { id: 'u-1' } } },
    _playerId: 'bm-1',
    ...over,
  } as BmRecord & { _playerId?: string };
}

describe('notSatiri', () => {
  it('normal notu satıra çevirir, yazarı ilişkiden çözer', () => {
    const sonuc = notSatiri(not(), PLAYERS, USERS);
    expect('ok' in sonuc).toBe(true);
    if (!('ok' in sonuc)) return;
    expect(sonuc.ok.playerId).toBe('uuid-1');
    expect(sonuc.ok.body).toBe('Şüpheli hesap');
    expect(sonuc.ok.authorName).toBe('ModeratorAli');
    expect(sonuc.ok.externalId).toBe('n-1');
  });

  it('oyuncuyu `_playerId` DAMGASINDAN okur', () => {
    // Bu uç oyuncu başına çağrıldığı için kayıtta `player` ilişkisi
    // olmayabiliyor; arşivleyici bu yüzden damga basıyor.
    const sonuc = notSatiri(not({ relationships: {} }), PLAYERS, USERS);
    expect('ok' in sonuc && sonuc.ok.playerId).toBe('uuid-1');
  });

  it('damga yoksa `player` ilişkisine düşer', () => {
    const rec = not({ _playerId: undefined, relationships: { player: { data: { id: 'bm-1' } } } });
    const sonuc = notSatiri(rec, PLAYERS, USERS);
    expect('ok' in sonuc && sonuc.ok.playerId).toBe('uuid-1');
  });

  it('oyuncusu çözülemeyen notu ATLAR', () => {
    // Not SteamID/EOS taşımıyor; banlarda yaptığımız gibi "eksik oyuncuyu
    // kayıttan oluştur" burada mümkün değil. Hayalet oyuncu üretmektense
    // atlamak doğru.
    const sonuc = notSatiri(not({ _playerId: 'bilinmeyen' }), PLAYERS, USERS);
    expect(sonuc).toEqual({ atla: 'oyuncu_yok' });
  });

  it('gövdesi boş notu ATLAR', () => {
    for (const bos of ['', '   ', '\n']) {
      const sonuc = notSatiri(not({ attributes: { note: bos } }), PLAYERS, USERS);
      expect(sonuc).toEqual({ atla: 'govde_yok' });
    }
  });

  it('gövdeyi kırpar', () => {
    const sonuc = notSatiri(not({ attributes: { note: '  boşluklu  ' } }), PLAYERS, USERS);
    expect('ok' in sonuc && sonuc.ok.body).toBe('boşluklu');
  });

  it('`text` alanını da gövde olarak kabul eder', () => {
    // BM bazı not kayıtlarında `note` yerine `text` kullanıyor; tek alana
    // bakmak o notları sessizce düşürürdü.
    const sonuc = notSatiri(not({ attributes: { text: 'metin alanı' } }), PLAYERS, USERS);
    expect('ok' in sonuc && sonuc.ok.body).toBe('metin alanı');
  });

  it('yazarı bilinmeyen notu yine aktarır', () => {
    // Yazar adı değerli ama notun kendisi daha değerli; yazar yok diye
    // notu atmak geçmişi kaybetmek olurdu.
    const sonuc = notSatiri(not({ relationships: {} }), PLAYERS, new Map());
    expect('ok' in sonuc).toBe(true);
    expect('ok' in sonuc && sonuc.ok.authorName).toBeNull();
  });

  it('tarihi olmayan nota createdAt UYDURUR, notu düşürmez', () => {
    // `created_at` notNull; tarihsiz bir not yüzünden aktarımın patlaması
    // ya da notun atlanması, veriyi kaybetmek olurdu.
    const sonuc = notSatiri(not({ attributes: { note: 'tarihsiz' } }), PLAYERS, USERS);
    expect('ok' in sonuc).toBe(true);
    if (!('ok' in sonuc)) return;
    expect(sonuc.ok.createdAt).toBeInstanceOf(Date);
    expect(sonuc.ok.updatedAt).toBeNull();
  });

  it('güncellenme tarihini okur', () => {
    const sonuc = notSatiri(
      not({ attributes: { note: 'x', updatedAt: '2025-05-05T00:00:00.000Z' } }),
      PLAYERS,
      USERS,
    );
    expect('ok' in sonuc && sonuc.ok.updatedAt?.toISOString()).toBe('2025-05-05T00:00:00.000Z');
  });
});
