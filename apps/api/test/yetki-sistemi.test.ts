import { describe, expect, it } from 'vitest';
import { rolleriDuzenle } from '../src/lib/discord-roles.js';
import { izinleriBirlestir } from '../src/lib/roles.js';
import {
  GRUP_ADI,
  grupTuruHatasi,
  izinleriOku,
  izinleriYaz,
  turDegisimiHatasi,
} from '../src/lib/squad-groups.js';

/**
 * Discord rolünden yetki zinciri.
 *
 * Yetki artık her istekte Discord rollerinden hesaplanıyor; bu yüzden
 * birleştirme kuralı girişte de canlı çözümlemede de aynı fonksiyon. Kural
 * yanlışsa iki yöne de pahalı: fazla izin yetkisiz birine ban attırır, eksik
 * izin yetkiliyi sayfasından eder.
 */
describe('izinleri birleştirme', () => {
  it('eşleme yoksa üye, izin yok', () => {
    expect(izinleriBirlestir([])).toEqual({ systemRole: 'member', permissions: [] });
  });

  it('birden fazla rolün izinleri BİRLEŞİR, tekrar etmez', () => {
    const r = izinleriBirlestir([
      { systemRole: 'moderator', panelPermissions: ['player.view', 'player.kick'] },
      { systemRole: 'moderator', panelPermissions: ['player.kick', 'player.ban'] },
    ]);
    expect(new Set(r.permissions)).toEqual(new Set(['player.view', 'player.kick', 'player.ban']));
    expect(r.permissions).toHaveLength(3);
  });

  it('sistem rolünde en YÜKSEK olan kazanır, sıradan bağımsız', () => {
    const a = izinleriBirlestir([
      { systemRole: 'member', panelPermissions: [] },
      { systemRole: 'admin', panelPermissions: [] },
      { systemRole: 'moderator', panelPermissions: [] },
    ]);
    const b = izinleriBirlestir([
      { systemRole: 'admin', panelPermissions: [] },
      { systemRole: 'member', panelPermissions: [] },
    ]);
    expect(a.systemRole).toBe('admin');
    expect(b.systemRole).toBe('admin');
  });

  it('tanınmayan sistem rolü yetki YÜKSELTMEZ', () => {
    // Elle yazılmış bozuk bir satır kimseyi süper admin yapmamalı.
    const r = izinleriBirlestir([{ systemRole: 'tanri', panelPermissions: ['player.view'] }]);
    expect(r.systemRole).toBe('member');
    expect(r.permissions).toEqual(['player.view']);
  });
});

describe('oyun grubu kuralları', () => {
  it('izinler sabit sırada ve tekrarsız yazılır', () => {
    // Aynı izinler farklı sırayla gelince Admins.cfg değişmiş görünmemeli.
    expect(izinleriYaz(['kick', 'changemap', 'kick', 'cameraman'])).toBe(
      'changemap,kick,cameraman',
    );
    expect(izinleriYaz(['cameraman', 'changemap', 'kick'])).toBe('changemap,kick,cameraman');
  });

  it('Squad yazımı boşluk ve büyük harfe toleranslı okunur', () => {
    expect(izinleriOku(' Kick, ban ,,CAMERAMAN ')).toEqual(['kick', 'ban', 'cameraman']);
    expect(izinleriOku('')).toEqual([]);
  });

  it('elle verilen grup yalnızca rezerve slot içerebilir', () => {
    expect(grupTuruHatasi(['reserve'], 'manual')).toBeNull();
    expect(grupTuruHatasi([], 'manual')).toBeNull();
    // Elle verilen kick yetkisi, Discord'da rol alınınca düşmeyen yetki demek.
    expect(grupTuruHatasi(['reserve', 'kick'], 'manual')).not.toBeNull();
    expect(grupTuruHatasi(['kick', 'ban'], 'discord')).toBeNull();
  });

  it('elle kayıtları olan grup Discord türüne çevrilemez', () => {
    // Çevrilirse o kayıtlar admin listesinde reddedilir, oyuncular slot kaybeder.
    expect(turDegisimiHatasi('discord', 3)).not.toBeNull();
    expect(turDegisimiHatasi('discord', 0)).toBeNull();
    expect(turDegisimiHatasi('manual', 5)).toBeNull();
  });

  it('grup adı Admins.cfg satırını bölemez', () => {
    expect(GRUP_ADI.test('Admin')).toBe(true);
    expect(GRUP_ADI.test('Klan_WL2')).toBe(true);
    expect(GRUP_ADI.test('Admin:kick')).toBe(false);
    expect(GRUP_ADI.test('Ad=min')).toBe(false);
    expect(GRUP_ADI.test('Kıdemli Admin')).toBe(false);
    expect(GRUP_ADI.test('')).toBe(false);
  });
});

describe('Discord rol listesi', () => {
  const GUILD = '100000000000000001';
  const ham = [
    { id: GUILD, name: '@everyone', color: 0, position: 0, managed: false },
    { id: '200000000000000001', name: 'Üye', color: 0, position: 1, managed: false },
    { id: '200000000000000002', name: 'Admin', color: 0xe74c3c, position: 5, managed: false },
    { id: '200000000000000003', name: 'Altai Bot', color: 0x123, position: 6, managed: true },
    { id: '200000000000000004', name: 'Moderatör', color: 0x3498db, position: 3, managed: false },
  ];

  it('@everyone ve yönetilen roller elenir, sıra Discord’daki gibi', () => {
    const r = rolleriDuzenle(ham, GUILD);
    expect(r.map((x) => x.name)).toEqual(['Admin', 'Moderatör', 'Üye']);
  });

  it('renk #rrggbb, renksiz rol null', () => {
    const r = rolleriDuzenle(ham, GUILD);
    expect(r.find((x) => x.name === 'Admin')?.color).toBe('#e74c3c');
    expect(r.find((x) => x.name === 'Üye')?.color).toBeNull();
    // Baştaki sıfırlar korunmalı: 0x000123 → #000123, #123 değil.
    const koyu = {
      id: '200000000000000005',
      name: 'Koyu',
      color: 0x123,
      position: 2,
      managed: false,
    };
    expect(rolleriDuzenle([koyu], GUILD)[0]?.color).toBe('#000123');
  });
});
