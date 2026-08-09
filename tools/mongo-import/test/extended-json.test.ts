import { describe, expect, it } from 'vitest';
import { classifyId, defaultGrantMode, docId, toDate } from '../src/parse.js';

/**
 * mongoexport "extended JSON" üretiyor: tarihler {"$date": "..."} ve _id
 * {"$oid": "..."} nesnesi olarak geliyor. Bunları tanımamak SESSİZ veri
 * bozulmasına yol açtı — ilk kuru koşuda admin cam kayıtlarının tamamı
 * (5.698) elendi, grant ve link kayıtları ise gerçek tarih yerine "şimdi"
 * ile yazılacaktı. Testler o biçimleri kilitliyor.
 */

describe('toDate', () => {
  it('extended JSON $date nesnesini çözer', () => {
    const d = toDate({ $date: '2026-02-04T10:24:14.362Z' });
    expect(d?.toISOString()).toBe('2026-02-04T10:24:14.362Z');
  });

  it('düz ISO string çözer', () => {
    expect(toDate('2026-02-04T10:24:14.362Z')?.toISOString()).toBe('2026-02-04T10:24:14.362Z');
  });

  it('Date nesnesini olduğu gibi verir', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    expect(toDate(now)).toBe(now);
  });

  it('epoch milisaniye çözer', () => {
    expect(toDate(1770200654362)?.getTime()).toBe(1770200654362);
  });

  it('geçersiz girdilerde undefined döner', () => {
    expect(toDate(null)).toBeUndefined();
    expect(toDate(undefined)).toBeUndefined();
    expect(toDate('')).toBeUndefined();
    expect(toDate('tarih değil')).toBeUndefined();
    expect(toDate({})).toBeUndefined();
  });
});

describe('docId', () => {
  it('extended JSON $oid çözer', () => {
    expect(docId({ _id: { $oid: '69831e4e24c4d1cb67116f7e' } })).toBe('69831e4e24c4d1cb67116f7e');
  });

  it('düz string _id çözer', () => {
    expect(docId({ _id: '69831e4e24c4d1cb67116f7e' })).toBe('69831e4e24c4d1cb67116f7e');
  });
});

describe('classifyId', () => {
  it('SteamID64 tanır', () => {
    expect(classifyId('76561198432943263')).toEqual({ steamId: '76561198432943263' });
  });

  it('EOS ID tanır ve küçük harfe çevirir', () => {
    // AdminEntry.id gerçek veride hem Steam hem EOS tutuyor (456/90) —
    // ayrımı biçimden yapmak zorundayız.
    expect(classifyId('0002FC32ED7C4CA2827647182633BC88')).toEqual({
      eosId: '0002fc32ed7c4ca2827647182633bc88',
    });
  });

  it('tanımadığı biçimde boş döner', () => {
    expect(classifyId('Crux')).toEqual({});
    expect(classifyId('')).toEqual({});
    expect(classifyId(null)).toEqual({});
    // 17 hane ama Steam öneki değil
    expect(classifyId('12345678901234567')).toEqual({});
  });
});

describe('defaultGrantMode', () => {
  it('sadece reserve veren grup ELLE verilir', () => {
    // KlanWL, VeteranWL, BagisWL... rezerve slot dışında bir şey vermiyor.
    expect(defaultGrantMode('reserve')).toBe('manual');
    expect(defaultGrantMode('')).toBe('manual');
    expect(defaultGrantMode('  reserve  ')).toBe('manual');
  });

  it('kick/ban veren grup DISCORD zincirine bağlıdır', () => {
    expect(defaultGrantMode('cameraman,canseeadminchat,reserve')).toBe('discord');
    expect(defaultGrantMode('reserve,kick')).toBe('discord');
    expect(defaultGrantMode('chat,kick,ban,cheat,manageserver')).toBe('discord');
  });

  it('büyük/küçük harf farkı sonucu değiştirmez', () => {
    expect(defaultGrantMode('RESERVE')).toBe('manual');
    expect(defaultGrantMode('Reserve,BAN')).toBe('discord');
  });

  it('gerçek gruplar doğru sınıflanıyor', () => {
    // Canlı sunucudan alınan tanımlar.
    const real: Array<[string, string, 'discord' | 'manual']> = [
      [
        'SuperAdmin',
        'featuretest,chat,startvote,reserve,demos,changemap,cheat,kick,ban,manageserver',
        'discord',
      ],
      [
        'Admin',
        'cameraman,canseeadminchat,reserve,teamchange,chat,forceteamchange,balance',
        'discord',
      ],
      ['KlanWL', 'reserve', 'manual'],
      ['VeteranWL', 'reserve', 'manual'],
      ['BagisWL', 'reserve', 'manual'],
      ['SquadLeadPerm', '', 'manual'],
    ];
    for (const [name, perms, expected] of real) {
      expect(defaultGrantMode(perms), name).toBe(expected);
    }
  });
});
