import { describe, expect, it } from 'vitest';
import type { SquadJSOnlinePlayer, SquadJSPlayer } from '../src/engine.js';
import { macSkorborduOlustur, satirlariTazele } from '../src/scoreboard.js';

/**
 * Skorbord kuralları burada kilitleniyor. Hepsi sessizce yanlış olabilecek
 * türden: bozulduğunda hata vermez, yalnızca istatistik çarpılır ve buna
 * dayanan takım dengeleme de yanlış karar verir.
 */

const ALI: SquadJSPlayer = {
  steamID: '76561190000000001',
  eosID: 'eos-ali',
  name: 'Ali',
  teamID: 1,
  squadID: 1,
  role: 'Rifleman',
  isLeader: false,
};
const VELI: SquadJSPlayer = {
  steamID: '76561190000000002',
  eosID: 'eos-veli',
  name: 'Veli',
  teamID: 2,
  squadID: 2,
  role: 'Medic',
  isLeader: false,
};

function satir(ozet: ReturnType<ReturnType<typeof macSkorborduOlustur>['bitir']>, eos: string) {
  const s = ozet.satirlar.find((x) => x.eosId === eos);
  if (!s) throw new Error(`${eos} skorbordda yok`);
  return s;
}

describe('öldürme sayımı', () => {
  it('öldüreni ve öleni ayrı ayrı sayar', () => {
    const sk = macSkorborduOlustur();
    sk.olum({ victim: VELI, attacker: ALI, teamkill: false });
    const ozet = sk.bitir();

    expect(satir(ozet, 'eos-ali')).toMatchObject({ kills: 1, deaths: 0 });
    expect(satir(ozet, 'eos-veli')).toMatchObject({ kills: 0, deaths: 1 });
  });

  it('takım öldürme kill saymaz, teamkills sayar', () => {
    // Aksi halde takım arkadaşlarını biçen oyuncu skorbordun tepesine çıkardı.
    const sk = macSkorborduOlustur();
    sk.olum({ victim: { ...VELI, teamID: 1 }, attacker: ALI, teamkill: true });
    const ozet = sk.bitir();

    expect(satir(ozet, 'eos-ali')).toMatchObject({ kills: 0, teamkills: 1, killstreak: 0 });
  });

  it('teamkill bilinmiyorsa normal öldürme sayar', () => {
    // Fork iki tarafı da çözemediğinde `teamkill` undefined geliyor.
    // Bilinmeyeni TK saymak, temiz oynayanları haksız yere TK listesine
    // sokardı; yanılma bu yönde daha ucuz.
    const sk = macSkorborduOlustur();
    sk.olum({ victim: VELI, attacker: ALI });
    expect(satir(sk.bitir(), 'eos-ali')).toMatchObject({ kills: 1, teamkills: 0 });
  });

  it('kendini öldürme ne kill ne TK sayar', () => {
    const sk = macSkorborduOlustur();
    sk.olum({ victim: ALI, attacker: ALI, teamkill: true });
    expect(satir(sk.bitir(), 'eos-ali')).toMatchObject({ kills: 0, teamkills: 0, deaths: 1 });
  });

  it('iki taraf da çözülemeyen ölümü sayar ama satır uydurmaz', () => {
    const sk = macSkorborduOlustur();
    sk.olum({ victim: null, attacker: null, weapon: 'BP_Mine' });
    const ozet = sk.bitir();

    // Sessizce yutmak "istatistik eksik mi" sorusunu cevapsız bırakırdı.
    expect(ozet.satirlar).toHaveLength(0);
    expect(ozet.atlananOlum).toBe(1);
  });
});

describe('killstreak', () => {
  it('ölünce sıfırlanır, en uzun seri korunur', () => {
    const sk = macSkorborduOlustur();
    sk.olum({ victim: VELI, attacker: ALI, teamkill: false });
    sk.olum({ victim: VELI, attacker: ALI, teamkill: false });
    sk.olum({ victim: VELI, attacker: ALI, teamkill: false });
    sk.olum({ victim: ALI, attacker: VELI, teamkill: false }); // Ali öldü
    sk.olum({ victim: VELI, attacker: ALI, teamkill: false });

    // Şu anki seri 1, ama maçın en uzunu 3.
    expect(satir(sk.bitir(), 'eos-ali')).toMatchObject({ kills: 4, killstreak: 3 });
  });
});

describe('silah kırılımı', () => {
  it('silah adına göre öldürmeleri toplar, silahsız ölümü atlar', () => {
    const sk = macSkorborduOlustur();
    sk.olum({ victim: VELI, attacker: ALI, weapon: 'BP_AK74', teamkill: false });
    sk.olum({ victim: VELI, attacker: ALI, weapon: 'BP_AK74', teamkill: false });
    sk.olum({ victim: VELI, attacker: ALI, weapon: 'BP_RPG7', teamkill: false });
    sk.olum({ victim: VELI, attacker: ALI, teamkill: false });

    expect(satir(sk.bitir(), 'eos-ali').weapons).toEqual({ BP_AK74: 2, BP_RPG7: 1 });
  });
});

describe('canlandırma', () => {
  it('canlandıranı sayar ve canlandırılanı skorborda sokar', () => {
    const sk = macSkorborduOlustur();
    sk.canlandirma({ reviver: VELI, victim: ALI });
    const ozet = sk.bitir();

    expect(satir(ozet, 'eos-veli')).toMatchObject({ revives: 1 });
    // Hiç öldürmemiş ama maçta olmuş oyuncunun satırı olmalı.
    expect(satir(ozet, 'eos-ali')).toMatchObject({ revives: 0, kills: 0 });
  });
});

describe('hasar', () => {
  it('veren ve alan tarafa ayrı yazar, ondalığı yuvarlar', () => {
    const sk = macSkorborduOlustur();
    sk.hasar({ victim: VELI, attacker: ALI, damage: 30.4 });
    sk.hasar({ victim: VELI, attacker: ALI, damage: 30.4 });
    const ozet = sk.bitir();

    expect(satir(ozet, 'eos-ali').damageDealt).toBe(61);
    expect(satir(ozet, 'eos-veli').damageTaken).toBe(61);
  });

  it('kendine verilen hasarı damageDealt saymaz', () => {
    const sk = macSkorborduOlustur();
    sk.hasar({ victim: ALI, attacker: ALI, damage: 50 });
    expect(satir(sk.bitir(), 'eos-ali')).toMatchObject({ damageDealt: 0, damageTaken: 50 });
  });

  it('geçersiz veya sıfır hasarı yok sayar', () => {
    const sk = macSkorborduOlustur();
    sk.hasar({ victim: VELI, attacker: ALI, damage: Number.NaN });
    sk.hasar({ victim: VELI, attacker: ALI, damage: 0 });
    expect(sk.bitir().satirlar).toHaveLength(0);
  });
});

describe('kimlik', () => {
  it('SteamID sonradan gelirse satıra yazar', () => {
    // Squad oyuncuyu EOS ile tanıyor; SteamID RCON listesine sonradan
    // düşebiliyor. Aynı kişi iki satıra bölünmemeli.
    const sk = macSkorborduOlustur();
    sk.olum({ victim: VELI, attacker: { eosID: 'eos-ali', name: 'Ali' }, teamkill: false });
    sk.olum({ victim: VELI, attacker: ALI, teamkill: false });
    const ozet = sk.bitir();

    expect(ozet.satirlar.filter((s) => s.eosId === 'eos-ali')).toHaveLength(1);
    expect(satir(ozet, 'eos-ali')).toMatchObject({ steamId: ALI.steamID, kills: 2 });
  });

  it('kimliksiz oyuncu satır açmaz', () => {
    const sk = macSkorborduOlustur();
    sk.olum({ victim: { name: 'Hayalet' } as SquadJSPlayer, attacker: null });
    expect(sk.bitir().satirlar).toHaveLength(0);
  });
});

describe('bitir', () => {
  it('maçı kapatınca sayaçlar sıfırlanır', () => {
    const sk = macSkorborduOlustur();
    sk.olum({ victim: VELI, attacker: ALI, teamkill: false });
    sk.bitir();
    expect(sk.bitir()).toEqual({ satirlar: [], atlananOlum: 0 });
  });
});

describe('satirlariTazele', () => {
  const CEVRIMICI: SquadJSOnlinePlayer[] = [
    {
      steamId: '76561190000000001',
      eosId: 'eos-ali',
      name: 'Ali (yeni ad)',
      teamId: 2,
      squadId: 5,
      squadName: 'BRAVO',
      role: 'SL',
      isLeader: true,
    },
  ];

  it('maç sonundaki takım/manga/rol bilgisini yazar', () => {
    const sk = macSkorborduOlustur();
    sk.olum({ victim: VELI, attacker: ALI, teamkill: false });
    const tazelenmis = satirlariTazele(sk.bitir().satirlar, CEVRIMICI);

    const ali = tazelenmis.find((s) => s.eosId === 'eos-ali');
    // Ali maç içinde 1. takımdaydı; kazanan/kaybeden ayrımı SON duruma bakar.
    expect(ali).toMatchObject({ teamId: 2, squadId: 5, role: 'SL', isLeader: true, kills: 1 });
    expect(ali?.name).toBe('Ali (yeni ad)');
  });

  it('hiç öldürmemiş çevrimiçi oyuncuyu sıfır satırıyla ekler', () => {
    const tazelenmis = satirlariTazele([], CEVRIMICI);
    expect(tazelenmis).toHaveLength(1);
    expect(tazelenmis[0]).toMatchObject({ kills: 0, deaths: 0, eosId: 'eos-ali', teamId: 2 });
  });

  it('maç bitmeden çıkanları düşürmez', () => {
    const sk = macSkorborduOlustur();
    sk.olum({ victim: VELI, attacker: ALI, teamkill: false });
    const tazelenmis = satirlariTazele(sk.bitir().satirlar, CEVRIMICI);

    // Veli listede yok ama maçta oynadı; satırı son görülen değerlerle kalır.
    expect(tazelenmis.find((s) => s.eosId === 'eos-veli')).toMatchObject({
      deaths: 1,
      teamId: 2,
    });
  });
});
