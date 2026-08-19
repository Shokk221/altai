import type { RoundPlayerStat } from '@altai/contracts';
import { describe, expect, it } from 'vitest';
import { enIyiler, satirMetni } from '../src/plugins/round-scoreboard.js';

/**
 * Maç sonu duyurusunun sıralama kuralı.
 *
 * Duyuru sunucudaki herkesin gördüğü bir metin; yanlış sıralama ya da
 * sıfır öldürmeli birini "en iyi" diye yazmak, plugin'i gülünç eder ve
 * kimse ciddiye almaz.
 */

function p(over: Partial<RoundPlayerStat>): RoundPlayerStat {
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

describe('enIyiler', () => {
  it('öldürmeye göre çoktan aza sıralar ve ilk N"i alır', () => {
    const liste = enIyiler(
      [p({ name: 'Ali', kills: 5 }), p({ name: 'Veli', kills: 12 }), p({ name: 'Ayşe', kills: 8 })],
      'kills',
      2,
    );
    expect(liste.map((x) => x.name)).toEqual(['Veli', 'Ayşe']);
  });

  it('sıfır değerli oyuncuları listeye almaz', () => {
    // Hiç öldürme yapmamış birini "maçın en iyisi" diye duyurmak,
    // listeyi doldurmak uğruna duyuruyu anlamsızlaştırırdı.
    const liste = enIyiler(
      [p({ name: 'Ali', kills: 0 }), p({ name: 'Veli', kills: 1 })],
      'kills',
      3,
    );
    expect(liste.map((x) => x.name)).toEqual(['Veli']);
  });

  it('herkes sıfırsa boş liste döner', () => {
    expect(enIyiler([p({ name: 'Ali' }), p({ name: 'Veli' })], 'kills', 3)).toEqual([]);
  });

  it('canlandırma ölçütünde canlandırmaya bakar', () => {
    const liste = enIyiler(
      [p({ name: 'Ali', kills: 30, revives: 1 }), p({ name: 'Veli', kills: 0, revives: 14 })],
      'revives',
      1,
    );
    expect(liste[0]?.name).toBe('Veli');
  });

  it('K/D ölçütünde hiç ölmeyeni öldürme sayısıyla değerlendirir', () => {
    // kdOrani ile aynı kural: sıfıra bölme yok, öldürme sayısı oran sayılır.
    const liste = enIyiler(
      [p({ name: 'Ali', kills: 3, deaths: 0 }), p({ name: 'Veli', kills: 10, deaths: 5 })],
      'kdr',
      2,
    );
    expect(liste.map((x) => x.name)).toEqual(['Ali', 'Veli']);
  });

  it('eşitlikte isme göre sıralar — aynı maç iki kez işlense aynı sıra', () => {
    const a = enIyiler(
      [p({ name: 'Zeynep', kills: 4 }), p({ name: 'Ahmet', kills: 4 })],
      'kills',
      2,
    );
    const b = enIyiler(
      [p({ name: 'Ahmet', kills: 4 }), p({ name: 'Zeynep', kills: 4 })],
      'kills',
      2,
    );
    expect(a.map((x) => x.name)).toEqual(b.map((x) => x.name));
    expect(a[0]?.name).toBe('Ahmet');
  });
});

describe('satirMetni', () => {
  it('öldürme ölçütünde sıra, isim ve sayıyı yazar', () => {
    expect(satirMetni(p({ name: 'Ali', kills: 12 }), 'kills', 1)).toBe('1. Ali — 12 öldürme');
  });

  it('K/D ölçütünde ham sayıları da gösterir', () => {
    // Yalnızca oran göstermek "2.0" ile "20/10" farkını gizlerdi.
    expect(satirMetni(p({ name: 'Ali', kills: 20, deaths: 10 }), 'kdr', 2)).toBe(
      '2. Ali — K/D 2 (20/10)',
    );
  });

  it('ismi olmayan oyuncuyu boş bırakmaz', () => {
    expect(satirMetni(p({ name: '  ', kills: 3 }), 'kills', 1)).toBe('1. (bilinmeyen) — 3 öldürme');
  });
});
