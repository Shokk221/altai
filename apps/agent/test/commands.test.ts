import type { AgentCommand } from '@altai/contracts';
import type { SquadJSEngine } from '@altai/squad';
import { describe, expect, it } from 'vitest';
import { komutCalistir } from '../src/commands.js';

/**
 * Komutların RCON'a nasıl çevrildiği.
 *
 * Özellikle `listPlayers` + `taze`: SquadJS oyuncu listesini bellekte
 * tutuyor ve 10 saniyede bir yeniliyor. Takım değiştirme komutunun hemen
 * ardından bu önbelleği okumak, komuttan ÖNCEKİ durumu döndürüyordu —
 * panelde oyuncu karşıya geçip sonra eski takımına dönüyor gibi
 * görünüyordu. Tazeleme atlanırsa hata yine sessiz olur.
 */

function sahteEngine() {
  const cagrilar: string[] = [];
  let tazelendi = 0;

  const engine = {
    serverSlug: 'squad-01',
    on() {},
    off() {},
    async getStatus() {
      return { playerCount: 1, publicQueue: 0 };
    },
    async refreshPlayers() {
      tazelendi += 1;
    },
    async getPlayers() {
      return [
        {
          steamId: '76561190000000001',
          eosId: null,
          name: 'oyuncu',
          teamId: tazelendi > 0 ? 2 : 1,
          squadId: null,
          squadName: null,
          role: null,
          isLeader: false,
        },
      ];
    },
    async rconExecute(command: string) {
      cagrilar.push(command);
      return 'ok';
    },
  } satisfies SquadJSEngine;

  return { engine, cagrilar, tazeSayisi: () => tazelendi };
}

function komut(action: AgentCommand['action'], payload: Record<string, unknown>): AgentCommand {
  return {
    correlationId: '00000000-0000-4000-8000-000000000000',
    serverId: 'squad-01',
    action,
    payload,
    issuedBy: 'test',
  };
}

describe('listPlayers tazeleme', () => {
  it('taze istendiğinde önbelleği RCON’dan yeniler', async () => {
    const { engine, tazeSayisi } = sahteEngine();
    await komutCalistir(engine, komut('listPlayers', { taze: true }));
    expect(tazeSayisi()).toBe(1);
  });

  it('taze istenmediğinde önbelleği okur — periyodik tazelemeye yük bindirmez', async () => {
    const { engine, tazeSayisi } = sahteEngine();
    await komutCalistir(engine, komut('listPlayers', {}));
    expect(tazeSayisi()).toBe(0);
  });

  it('tazeledikten SONRA okur, önce değil', async () => {
    const { engine } = sahteEngine();
    const sonuc = await komutCalistir(engine, komut('listPlayers', { taze: true }));
    const veri = sonuc.data as { players: { teamId: number | null }[] };
    // Sahte engine tazelemeden önce takım 1, sonra takım 2 döndürüyor;
    // sıra ters olsaydı burada 1 görürdük.
    expect(veri.players[0]?.teamId).toBe(2);
  });
});

describe('takım değiştirme komutu', () => {
  it('AdminForceTeamChange gönderir', async () => {
    const { engine, cagrilar } = sahteEngine();
    await komutCalistir(engine, komut('forceTeamChange', { steamId: '76561190000000001' }));
    expect(cagrilar).toEqual(['AdminForceTeamChange 76561190000000001']);
  });

  it('EOS varsa onu tercih eder — Squad oyuncuyu EOS ile tanıyor', async () => {
    const { engine, cagrilar } = sahteEngine();
    await komutCalistir(
      engine,
      komut('forceTeamChange', {
        steamId: '76561190000000001',
        eosId: '0002440e6f864e30b83891a8d9f60497',
      }),
    );
    expect(cagrilar[0]).toBe('AdminForceTeamChange 0002440e6f864e30b83891a8d9f60497');
  });

  it('kimlik yoksa RCON’a hiç gitmez', async () => {
    const { engine, cagrilar } = sahteEngine();
    const sonuc = await komutCalistir(engine, komut('forceTeamChange', {}));
    expect(sonuc).toEqual({ ok: false, error: 'gecerli_kimlik_yok' });
    expect(cagrilar).toHaveLength(0);
  });
});
