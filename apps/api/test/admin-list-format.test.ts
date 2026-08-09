import { describe, expect, it } from 'vitest';
import { type AdminEntry, formatAdminList } from '../src/lib/admin-list-format.js';

/**
 * Admin listesi doğrudan oyun sunucusuna gidiyor ve YETKİ dağıtıyor.
 * Bozuk bir çıktı iki yönde de kötü: ya yetkisiz biri admin olur, ya bütün
 * adminler yetkisini kaybeder. Biçim canlı sunucudaki Admins.cfg'den alındı.
 */

const NOW = new Date('2026-08-09T12:00:00.000Z');

const GROUPS = [
  { name: 'SuperAdmin', permissions: 'chat,kick,ban,cameraman,manageserver' },
  { name: 'Admin', permissions: 'cameraman,canseeadminchat,reserve' },
  { name: 'KlanWL', permissions: 'reserve' },
];

function entry(over: Partial<AdminEntry> = {}): AdminEntry {
  return {
    steamId: '76561198000000001',
    eosId: '0002eaff43e44e6cb95207bab755c353',
    groupName: 'Admin',
    ...over,
  };
}

const records = (out: string) =>
  out
    .split('\n')
    .filter((l) => l && !l.startsWith('//'))
    .map((l) => l.trim());

describe('formatAdminList', () => {
  it('grup tanımını ve admin satırını doğru biçimde yazar', () => {
    const { body } = formatAdminList({ groups: GROUPS, entries: [entry()], now: NOW });
    const r = records(body);
    expect(r).toContain('Group=Admin:cameraman,canseeadminchat,reserve');
    expect(r).toContain('Admin=0002eaff43e44e6cb95207bab755c353:Admin');
    expect(r).toContain('Admin=76561198000000001:Admin');
  });

  it('yalnızca kullanılan grupları yazar', () => {
    const { body } = formatAdminList({ groups: GROUPS, entries: [entry()], now: NOW });
    expect(body).not.toContain('Group=SuperAdmin');
    expect(body).not.toContain('Group=KlanWL');
  });

  it('hem EOS hem Steam satırı üretir', () => {
    const { adminCount } = formatAdminList({ groups: GROUPS, entries: [entry()], now: NOW });
    expect(adminCount).toBe(2);
  });

  it('tek kimliği olan oyuncu için tek satır', () => {
    const { body, adminCount } = formatAdminList({
      groups: GROUPS,
      entries: [entry({ eosId: null })],
      now: NOW,
    });
    expect(adminCount).toBe(1);
    expect(records(body).filter((l) => l.startsWith('Admin='))).toHaveLength(1);
  });

  it('aynı satırı iki kez yazmaz', () => {
    const { body } = formatAdminList({ groups: GROUPS, entries: [entry(), entry()], now: NOW });
    const admins = records(body).filter((l) => l.startsWith('Admin='));
    expect(new Set(admins).size).toBe(admins.length);
  });

  it('bir oyuncu birden çok gruptaysa her grup için satır yazar', () => {
    // Discord'da hem admin hem klan rolü olan biri: Squad yetkileri birleştirir.
    const { body } = formatAdminList({
      groups: GROUPS,
      entries: [entry({ groupName: 'Admin' }), entry({ groupName: 'KlanWL' })],
      now: NOW,
    });
    const r = records(body);
    expect(r).toContain('Admin=76561198000000001:Admin');
    expect(r).toContain('Admin=76561198000000001:KlanWL');
    expect(r).toContain('Group=KlanWL:reserve');
  });

  it('yorumdaki satır sonu dosyayı bozmaz', () => {
    const { body } = formatAdminList({
      groups: GROUPS,
      entries: [entry({ label: 'Crux\nGroup=Sahte:ban' })],
      now: NOW,
    });
    // Enjekte edilmiş sahte grup satırı oluşmamalı.
    expect(records(body)).not.toContain('Group=Sahte:ban');
    expect(records(body).filter((l) => l.startsWith('Group=')).length).toBe(1);
  });

  it('boş girdide sıfır admin bildirir (emniyet supabı bunu kullanır)', () => {
    const { adminCount } = formatAdminList({ groups: GROUPS, entries: [], now: NOW });
    expect(adminCount).toBe(0);
  });

  it('rol senkronu bayatsa başlıkta uyarır', () => {
    const { body } = formatAdminList({
      groups: GROUPS,
      entries: [entry()],
      now: NOW,
      rolesSyncedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(body).toContain('UYARI: Discord rol senkronu bayat');
  });

  it('senkron tazeyse uyarmaz', () => {
    const { body } = formatAdminList({
      groups: GROUPS,
      entries: [entry()],
      now: NOW,
      rolesSyncedAt: new Date('2026-08-09T11:00:00.000Z'),
    });
    expect(body).not.toContain('UYARI');
  });
});
