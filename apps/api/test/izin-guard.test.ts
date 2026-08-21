import type { Permission } from '@altai/contracts';
import { describe, expect, it } from 'vitest';

/**
 * Guard'ın izin kararı.
 *
 * Kural `auth-guard.ts` içinde tek satır ama yanlışı iki yöne de pahalı:
 * gevşek olursa yetkisiz biri veri görür, sıkı olursa yetkili biri
 * sayfasını açamaz. İkincisi gerçekten yaşandı — klan yönetimi
 * `plugin_config.write`, klan savaşları `clan.manage` istiyordu ve savaş
 * sayfasının doldurduğu klan listesi 403 dönüyordu.
 *
 * Buradaki fonksiyon guard'daki koşulun aynısı; guard'ın kendisi Fastify
 * ve oturum gerektirdiği için ayrıştırılamıyor, ama KARAR test edilebilir
 * olmalı.
 */
function erisebilir(
  gerekli: Permission | Permission[] | undefined,
  sahipOlunan: Permission[],
  superAdmin: boolean,
): boolean {
  const izinler = gerekli === undefined ? [] : Array.isArray(gerekli) ? gerekli : [gerekli];
  if (izinler.length === 0) return true;
  if (superAdmin) return true;
  return izinler.some((p) => sahipOlunan.includes(p));
}

describe('izin kontrolü', () => {
  it('izin istenmiyorsa oturum yeterli', () => {
    expect(erisebilir(undefined, [], false)).toBe(true);
  });

  it('tek izin: sahip olan geçer, olmayan geçmez', () => {
    expect(erisebilir('clan.manage', ['clan.manage'], false)).toBe(true);
    expect(erisebilir('clan.manage', ['player.view'], false)).toBe(false);
  });

  it('çoklu izinde HERHANGİ BİRİ yetiyor', () => {
    // Asıl düzeltme bu: klan yönetimi ve klan savaşları iki ayrı izne
    // bağlıydı ve savaş sayfası klan listesini çekemiyordu.
    const gerekli: Permission[] = ['plugin_config.write', 'clan.manage'];
    expect(erisebilir(gerekli, ['clan.manage'], false)).toBe(true);
    expect(erisebilir(gerekli, ['plugin_config.write'], false)).toBe(true);
  });

  it('çoklu izinde hiçbiri yoksa reddediyor', () => {
    expect(erisebilir(['plugin_config.write', 'clan.manage'], ['player.view'], false)).toBe(false);
  });

  it('super_admin her şeyi geçer', () => {
    // Yetki zincirinin kaçış kapısı: rol eşlemesi bozulduğunda sistemi
    // kurtaracak biri her zaman olmalı.
    expect(erisebilir(['admin_list.manage'], [], true)).toBe(true);
  });

  it('boş dizi izin istemiyor sayılıyor', () => {
    // `[]` ile `undefined` aynı davranmalı; ikisi arasında sessiz bir
    // fark, bir ucun yanlışlıkla herkese açılmasına yol açabilirdi.
    expect(erisebilir([], [], false)).toBe(true);
  });
});
