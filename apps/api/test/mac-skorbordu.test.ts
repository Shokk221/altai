import type { RoundPlayerStat } from '@altai/contracts';
import { describe, expect, it } from 'vitest';
import { kazandiMi, macToplamlari } from '../src/lib/persistence-writer.js';

/**
 * Maç sonu skorbordunun api tarafındaki iki kararı.
 *
 * İkisi de sessizce yanlış olabilecek türden: hata vermezler, yalnızca
 * istatistik çarpılır. Galibiyet oranı ve maç toplamları panelde en çok
 * bakılan sayılar, üstelik takım dengeleme de bunlara dayanacak.
 */

function oyuncu(over: Partial<RoundPlayerStat> = {}): RoundPlayerStat {
  return {
    kills: 0,
    deaths: 0,
    revives: 0,
    teamkills: 0,
    killstreak: 0,
    damageDealt: 0,
    damageTaken: 0,
    weapons: {},
    ...over,
  };
}

describe('maç toplamları', () => {
  it('satırlardan toplar ve oyuncu sayısını satır sayısından alır', () => {
    const toplam = macToplamlari([
      oyuncu({ kills: 12, revives: 3, teamkills: 1 }),
      oyuncu({ kills: 7, revives: 9, teamkills: 0 }),
      oyuncu(),
    ]);

    expect(toplam).toEqual({
      totalKills: 19,
      totalRevives: 12,
      totalTeamkills: 1,
      playerCount: 3,
    });
  });

  it('boş skorbordda sıfır döner, undefined değil', () => {
    // Kolonların null kalması "maç kaydedilmedi" gibi okunurdu; sıfır
    // "maç oldu, kimse bir şey yapmadı" demek ve ikisi farklı.
    expect(macToplamlari([])).toEqual({
      totalKills: 0,
      totalRevives: 0,
      totalTeamkills: 0,
      playerCount: 0,
    });
  });
});

describe('kazandı mı', () => {
  it('takım kazananla aynıysa true, değilse false', () => {
    expect(kazandiMi(1, 1)).toBe(true);
    expect(kazandiMi(2, 1)).toBe(false);
  });

  it('kazanan bildirilmediyse null — "kaybetti" değil', () => {
    // Beraberlikte ve kazananı log'a düşürmeyen modlarda herkesi kaybetmiş
    // saymak, galibiyet oranını sessizce sıfıra çekerdi.
    expect(kazandiMi(1, null)).toBeNull();
  });

  it('oyuncunun takımı çözülemediyse null', () => {
    // Maç bitmeden çıkan ve RCON listesinde görünmeyen oyuncularda olur.
    expect(kazandiMi(null, 1)).toBeNull();
    expect(kazandiMi(undefined, 1)).toBeNull();
  });
});
