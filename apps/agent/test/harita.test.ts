import type { AgentCommand } from '@altai/contracts';
import type { SquadJSEngine } from '@altai/squad';
import { describe, expect, it } from 'vitest';
import { komutCalistir } from '../src/commands.js';
import { haritaBilgisiAyikla, katmanlariAyikla } from '../src/harita.js';

/**
 * Harita değiştirme.
 *
 * İki pahalı hata var: yanlış komut ("sıradaki yap" denirken haritayı O AN
 * değiştirmek maçı ortasında bitirir) ve RCON'a temizlenmemiş argüman
 * (satır sonu ikinci bir komut çalıştırır). İkisi de sessiz olurdu.
 */

function sahteEngine(cevaplar: Record<string, string> = {}) {
  const cagrilar: string[] = [];
  const engine = {
    serverSlug: 'squad-01',
    on() {},
    off() {},
    async getStatus() {
      return { playerCount: 0, publicQueue: 0 };
    },
    async refreshPlayers() {},
    async getPlayers() {
      return [];
    },
    async rconExecute(command: string) {
      cagrilar.push(command);
      return cevaplar[command] ?? 'ok';
    },
  } satisfies SquadJSEngine;
  return { engine, cagrilar };
}

function komut(
  action: AgentCommand['action'],
  payload: Record<string, unknown> = {},
): AgentCommand {
  return {
    correlationId: '00000000-0000-4000-8000-000000000000',
    serverId: 'squad-01',
    action,
    payload,
    issuedBy: 'test',
  };
}

describe('harita komutları', () => {
  it('"sıradaki" AdminSetNextLayer, "şimdi" AdminChangeLayer gönderir', async () => {
    const { engine, cagrilar } = sahteEngine();
    await komutCalistir(engine, komut('setLayer', { layer: 'Narva_RAAS_v1', zaman: 'sonraki' }));
    await komutCalistir(engine, komut('setLayer', { layer: 'Narva_RAAS_v1', zaman: 'simdi' }));
    expect(cagrilar).toEqual(['AdminSetNextLayer Narva_RAAS_v1', 'AdminChangeLayer Narva_RAAS_v1']);
  });

  it('zaman belirtilmezse güvenli taraf: sıradaki', async () => {
    // Bilinmeyen değer maçı o an bitirmemeli.
    const { engine, cagrilar } = sahteEngine();
    await komutCalistir(engine, komut('setLayer', { layer: 'Narva_RAAS_v1' }));
    await komutCalistir(engine, komut('setLayer', { layer: 'Narva_RAAS_v1', zaman: 'hemen' }));
    expect(cagrilar).toEqual([
      'AdminSetNextLayer Narva_RAAS_v1',
      'AdminSetNextLayer Narva_RAAS_v1',
    ]);
  });

  it('kalıba uymayan katman adı RCON’a hiç gitmez', async () => {
    const { engine, cagrilar } = sahteEngine();
    for (const layer of ['Narva_RAAS_v1\nAdminKillServer', 'Narva RAAS', 'Narva', '', 42]) {
      const r = await komutCalistir(engine, komut('setLayer', { layer, zaman: 'simdi' }));
      expect(r.ok).toBe(false);
    }
    expect(cagrilar).toEqual([]);
  });

  it('restart maçı yeniden başlatır', async () => {
    const { engine, cagrilar } = sahteEngine();
    const r = await komutCalistir(engine, komut('restart'));
    expect(r.ok).toBe(true);
    expect(cagrilar).toEqual(['AdminRestartMatch']);
  });

  it('mapInfo şu anki ve sıradaki haritayı döndürür', async () => {
    const { engine } = sahteEngine({
      ShowCurrentMap: 'Current level is Narva, layer is Narva_RAAS_v1, factions USA RGF',
      ShowNextMap: 'Next level is Yehorivka, layer is Yehorivka_AAS_v2, factions WPMC ADF',
    });
    const r = await komutCalistir(engine, komut('mapInfo'));
    expect(r).toEqual({
      ok: true,
      data: {
        simdiki: { level: 'Narva', layer: 'Narva_RAAS_v1' },
        sonraki: { level: 'Yehorivka', layer: 'Yehorivka_AAS_v2' },
      },
    });
  });
});

describe('harita cevaplarını ayrıştırma', () => {
  it('oylamaya bırakılmış sıradaki harita null', () => {
    const b = haritaBilgisiAyikla(
      'Current level is Narva, layer is Narva_RAAS_v1',
      'Next level is , layer is To be voted',
    );
    expect(b.sonraki).toEqual({ level: null, layer: null });
  });

  it('tanınmayan cevap null döner, patlamaz', () => {
    expect(haritaBilgisiAyikla('', 'beklenmeyen')).toEqual({
      simdiki: { level: null, layer: null },
      sonraki: { level: null, layer: null },
    });
  });

  it('ListLayers: başlık ve boş satır elenir, açıklamalı satırdan ad alınır, sıralı ve tekrarsız', () => {
    const cevap = [
      'List of available layers :',
      'Yehorivka_AAS_v2',
      'AlBasrah_Invasion_v1 (Al Basrah)',
      '',
      'Narva_RAAS_v1\r',
      'Yehorivka_AAS_v2',
    ].join('\n');
    expect(katmanlariAyikla(cevap)).toEqual([
      'AlBasrah_Invasion_v1',
      'Narva_RAAS_v1',
      'Yehorivka_AAS_v2',
    ]);
  });
});
