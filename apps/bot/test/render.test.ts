import type { AgentEvent } from '@altai/contracts';
import { describe, expect, it } from 'vitest';
import { adminCagrisiGomusu, macSonuGomusu, teamkillGomusu } from '../src/render.js';

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

const cagri = (
  over: Record<string, unknown> = {},
): Extract<AgentEvent, { type: 'ADMIN_REQUEST' }> =>
  ({
    type: 'ADMIN_REQUEST',
    serverSlug: 'squad-01',
    playerName: 'Oyuncu',
    steamId: '76561190000000001',
    reason: 'Hileci var',
    onlineAdmins: 2,
    timestamp: '2026-08-16T12:00:00.000Z',
    ...over,
  }) as Extract<AgentEvent, { type: 'ADMIN_REQUEST' }>;

describe('adminCagrisiGomusu', () => {
  it('sebebi açıklamaya yazar', () => {
    expect(adminCagrisiGomusu(cagri()).description).toBe('Hileci var');
  });

  it('sebep yoksa alan GİZLENMEZ, belirtilmedi yazar', () => {
    // Sebebin yokluğu da bilgi: çağrının aceleyle yapıldığını söylüyor.
    expect(adminCagrisiGomusu(cagri({ reason: null })).description).toContain('belirtilmedi');
  });

  it('sunucudaki yetkili sayısını gösterir', () => {
    const alan = adminCagrisiGomusu(cagri()).fields?.find((f) => f.name === 'Sunucudaki yetkili');
    expect(alan?.value).toBe('2');
  });

  it('hiç yetkili yoksa "yok" yazar', () => {
    // "0" ile "yok" aynı bilgi ama ikincisi bir bakışta okunuyor.
    const alan = adminCagrisiGomusu(cagri({ onlineAdmins: 0 })).fields?.find(
      (f) => f.name === 'Sunucudaki yetkili',
    );
    expect(alan?.value).toBe('yok');
  });

  it('çağıranın profiline bağlantı verir', () => {
    const alan = adminCagrisiGomusu(cagri()).fields?.find((f) => f.name === 'Çağıran');
    expect(alan?.value).toContain('steamcommunity.com/profiles/76561190000000001');
  });
});

/**
 * Maç sonu kartındaki skorbord.
 *
 * Veri `ROUND_ENDED`'ın kendi yükünden geliyor (Faz 4), bot ayrıca sorgu
 * atmıyor. Bu yüzden kartın doğruluğu tamamen buradaki sıralamaya bağlı.
 */
describe('maç sonu skorbordu', () => {
  const oyuncu = (name: string, kills: number, deaths = 0) => ({
    name,
    kills,
    deaths,
    revives: 0,
    teamkills: 0,
    killstreak: 0,
    damageDealt: 0,
    damageTaken: 0,
    weapons: {},
  });

  it('ilk üçü öldürmeye göre yazar', () => {
    const g = macSonuGomusu(
      mac({
        players: [
          oyuncu('Ali', 5, 3),
          oyuncu('Veli', 12, 4),
          oyuncu('Ayşe', 8, 2),
          oyuncu('Mehmet', 1, 9),
        ],
      }),
    );
    const alan = g.fields?.find((f) => f.name === 'En çok öldüren');
    expect(alan?.value).toBe('1. Veli — 12/4\n2. Ayşe — 8/2\n3. Ali — 5/3');
  });

  it('hiç öldürme yapmamışları listeye almaz', () => {
    const g = macSonuGomusu(mac({ players: [oyuncu('Ali', 0), oyuncu('Veli', 2)] }));
    expect(g.fields?.find((f) => f.name === 'En çok öldüren')?.value).toBe('1. Veli — 2/0');
  });

  it('skorbord yoksa alan hiç eklenmez', () => {
    // Agent maç ortasında başlamış olabilir; uydurma bir liste göstermek
    // olmayan bir maçı duyurmak olurdu.
    const alanlar = macSonuGomusu(mac()).fields ?? [];
    expect(alanlar.some((f) => f.name === 'En çok öldüren')).toBe(false);
  });

  it('herkes sıfır öldürmeyse alan eklenmez', () => {
    const alanlar =
      macSonuGomusu(mac({ players: [oyuncu('Ali', 0), oyuncu('Veli', 0)] })).fields ?? [];
    expect(alanlar.some((f) => f.name === 'En çok öldüren')).toBe(false);
  });
});
