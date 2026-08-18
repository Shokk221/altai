import type { AgentEvent } from '@altai/contracts';
import { describe, expect, it } from 'vitest';
import { macSonuGomusu, teamkillGomusu } from '../src/render.js';

/**
 * Discord kartlarının içeriği.
 *
 * Bu kartlara bakan kişi moderasyon kararı veriyor: "kim kimi vurdu"
 * yanlış sırada yazılırsa suçlu ile mağdur yer değiştirir. Saf fonksiyon
 * oldukları için Discord bağlantısı olmadan test edilebiliyorlar.
 */

const tk = (over: Record<string, unknown> = {}): Extract<AgentEvent, { type: 'TEAMKILL' }> =>
  ({
    type: 'TEAMKILL',
    serverSlug: 'squad-01',
    attackerName: 'Saldiran',
    attackerSteamId: '76561190000000001',
    victimName: 'Kurban',
    victimSteamId: '76561190000000002',
    weapon: 'M4',
    timestamp: '2026-08-16T12:00:00.000Z',
    ...over,
  }) as Extract<AgentEvent, { type: 'TEAMKILL' }>;

describe('teamkillGomusu', () => {
  it('başlıkta SALDIRAN var', () => {
    // Moderatörün aradığı bilgi "kim yaptı". Eski eklenti kurbanı öne
    // alıyordu ve kartlara bakan kişi iki ismi karıştırıyordu.
    expect(teamkillGomusu(tk()).title).toBe('Takım öldürme: Saldiran');
  });

  it('yön saldırandan kurbana', () => {
    expect(teamkillGomusu(tk()).description).toBe('**Saldiran** → **Kurban**');
  });

  it('SteamID varsa profil bağlantısı kurulur', () => {
    const alan = teamkillGomusu(tk()).fields?.find((f) => f.name === 'Saldıran');
    expect(alan?.value).toContain('steamcommunity.com/profiles/76561190000000001');
  });

  it('SteamID yoksa yalnızca isim yazılır', () => {
    const alan = teamkillGomusu(tk({ attackerSteamId: null })).fields?.find(
      (f) => f.name === 'Saldıran',
    );
    expect(alan?.value).toBe('Saldiran');
  });

  it('isim yoksa "bilinmeyen" kullanılır', () => {
    expect(teamkillGomusu(tk({ attackerName: null })).title).toBe('Takım öldürme: bilinmeyen');
  });

  it('boş isim de bilinmeyen sayılır', () => {
    expect(teamkillGomusu(tk({ victimName: '   ' })).description).toContain('bilinmeyen');
  });

  it('silah bilinmiyorsa alan HİÇ eklenmez', () => {
    // "bilinmeyen" yazan bir alan okuyana bir şey söylemiyor, yer kaplıyor.
    const alanlar = teamkillGomusu(tk({ weapon: null })).fields ?? [];
    expect(alanlar.some((f) => f.name === 'Silah')).toBe(false);
  });

  it('sunucu adı altbilgide', () => {
    expect(teamkillGomusu(tk()).footer?.text).toBe('squad-01');
  });
});

const mac = (over: Record<string, unknown> = {}): Extract<AgentEvent, { type: 'ROUND_ENDED' }> =>
  ({
    type: 'ROUND_ENDED',
    serverSlug: 'squad-01',
    winnerTeam: 1,
    winnerFaction: 'USA',
    loserFaction: 'RUS',
    winnerTickets: 400,
    loserTickets: 100,
    timestamp: '2026-08-16T12:00:00.000Z',
    ...over,
  }) as Extract<AgentEvent, { type: 'ROUND_ENDED' }>;

describe('macSonuGomusu', () => {
  it('kazananı başlığa yazar', () => {
    expect(macSonuGomusu(mac()).title).toBe('Maç bitti — USA kazandı');
  });

  it('bilet FARKINI hesaplar', () => {
    // Farkı zihinde çıkarmak, maçın ezici mi çekişmeli mi geçtiğini
    // anlamayı gereksizce yavaşlatıyor.
    const alan = macSonuGomusu(mac()).fields?.find((f) => f.name === 'Bilet');
    expect(alan?.value).toBe('400 — 100 (fark 300)');
  });

  it('faction bilinmiyorsa takım numarası kullanılır', () => {
    expect(macSonuGomusu(mac({ winnerFaction: null })).title).toBe('Maç bitti — 1. takım kazandı');
  });

  it('kazanan hiç bilinmiyorsa sade başlık', () => {
    expect(macSonuGomusu(mac({ winnerFaction: null, winnerTeam: undefined })).title).toBe(
      'Maç bitti',
    );
  });

  it('bilet bilgisi eksikse alan eklenmez', () => {
    const alanlar = macSonuGomusu(mac({ winnerTickets: undefined })).fields ?? [];
    expect(alanlar.some((f) => f.name === 'Bilet')).toBe(false);
  });

  it('hiçbir ayrıntı yoksa fields hiç olmaz', () => {
    const g = macSonuGomusu(
      mac({
        winnerFaction: null,
        loserFaction: null,
        winnerTeam: undefined,
        winnerTickets: undefined,
        loserTickets: undefined,
      }),
    );
    expect(g.fields).toBeUndefined();
  });
});
