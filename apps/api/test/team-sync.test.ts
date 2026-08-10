import { describe, expect, it } from 'vitest';
import { applyTeamChange, getServerState, replacePlayers } from '../src/lib/server-state.js';

/**
 * Takım değişiminin canlı listeye anında yansıması.
 *
 * RCON tazelemesi 20 saniyede bir; ona bırakınca yetkili oyuncuyu karşıya
 * attıktan sonra ekranda eski takımda görüyor ve komut çalışmadı sanıyor.
 * Gerçek kurulumda böyle görüldü, sonra bu yazıldı.
 */

function oyuncu(steamId: string, teamId: number | null, squadId: number | null) {
  return {
    steamId,
    eosId: null,
    name: `oyuncu-${steamId}`,
    teamId,
    squadId,
    squadName: squadId ? `Manga ${squadId}` : null,
    role: null,
    isLeader: squadId === 1,
  };
}

function kur(slug: string) {
  replacePlayers(
    slug,
    [oyuncu('76561190000000001', 1, 1), oyuncu('76561190000000002', 2, 3)],
    new Date().toISOString(),
  );
}

describe('canlı listede takım değişimi', () => {
  it('oyuncuyu karşı takıma alır', () => {
    kur('t1');
    applyTeamChange('t1', ['76561190000000001']);

    const p = getServerState('t1')?.players.find((x) => x.steamId === '76561190000000001');
    expect(p?.teamId).toBe(2);
  });

  it('mangadan çıkarır — manga öteki takımda kalıyor', () => {
    kur('t2');
    applyTeamChange('t2', ['76561190000000001']);

    const p = getServerState('t2')?.players.find((x) => x.steamId === '76561190000000001');
    expect(p?.squadId).toBeNull();
    expect(p?.squadName).toBeNull();
    expect(p?.isLeader).toBe(false);
  });

  it('diğer oyunculara dokunmaz', () => {
    kur('t3');
    applyTeamChange('t3', ['76561190000000001']);

    const p = getServerState('t3')?.players.find((x) => x.steamId === '76561190000000002');
    expect(p?.teamId).toBe(2);
    expect(p?.squadId).toBe(3);
  });

  it('takımı bilinmeyeni olduğu gibi bırakır — tazeleme düzeltir', () => {
    replacePlayers('t4', [oyuncu('76561190000000003', null, null)], new Date().toISOString());
    applyTeamChange('t4', ['76561190000000003']);

    expect(getServerState('t4')?.players[0]?.teamId).toBeNull();
  });

  it('mangayı komple geçirir', () => {
    replacePlayers(
      't5',
      [oyuncu('76561190000000001', 1, 1), oyuncu('76561190000000004', 1, 1)],
      new Date().toISOString(),
    );
    applyTeamChange('t5', ['76561190000000001', '76561190000000004']);

    expect(getServerState('t5')?.players.every((p) => p.teamId === 2)).toBe(true);
  });

  it('bilinmeyen sunucuda çökmez', () => {
    expect(() => applyTeamChange('yok-boyle-sunucu', ['76561190000000001'])).not.toThrow();
  });
});
