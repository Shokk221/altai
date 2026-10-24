import { type Permission, SYSTEM_ROLES, type SystemRole } from '@altai/contracts';
import type { Db } from '@altai/db';
import { accessSchema } from '@altai/db';
import { eq, inArray } from 'drizzle-orm';

export interface ResolvedRoles {
  systemRole: SystemRole;
  permissions: Permission[];
}

const YETKISIZ: ResolvedRoles = { systemRole: 'member', permissions: [] };

/**
 * Eşlemeleri tek bir yetkiye indirger: izinler BİRLEŞİR, sistem rolü en
 * yüksek olan kazanır.
 *
 * Saf fonksiyon, veritabanına dokunmuyor: kural tek yerde ve test
 * edilebilir. Hem giriş hem her istekteki canlı çözümleme bunu kullanıyor;
 * iki ayrı birleştirme mantığı, girişte "admin" görünüp ilk istekte
 * "moderatör"e düşen bir hesap üretirdi.
 */
export function izinleriBirlestir(
  eslemeler: readonly { systemRole: string; panelPermissions: readonly string[] }[],
): ResolvedRoles {
  if (eslemeler.length === 0) return YETKISIZ;

  const izinler = new Set<Permission>();
  let enIyi = SYSTEM_ROLES.length - 1; // en düşük öncelik

  for (const e of eslemeler) {
    for (const p of e.panelPermissions) izinler.add(p as Permission);
    const i = SYSTEM_ROLES.indexOf(e.systemRole as SystemRole);
    if (i !== -1 && i < enIyi) enIyi = i;
  }

  return { systemRole: SYSTEM_ROLES[enIyi] ?? 'member', permissions: [...izinler] };
}

// Discord'daki bir kullanıcının rol ID listesini alır, role_mappings tablosunda
// eşleşenleri bulur ve tek yetkiye indirger. Eşleşme yoksa en düşük rol
// (member, boş izin) döner — panele girer ama hiçbir şey yapamaz.
export async function resolveRoles(db: Db, discordRoleIds: string[]): Promise<ResolvedRoles> {
  if (discordRoleIds.length === 0) return YETKISIZ;

  const mappings = await db
    .select()
    .from(accessSchema.roleMappings)
    .where(inArray(accessSchema.roleMappings.discordRoleId, discordRoleIds));

  return izinleriBirlestir(mappings);
}

/**
 * Bir Discord hesabının ŞU ANKİ yetkisi.
 *
 * Kaynak `discord_member_roles`: bot Discord'daki rol değişikliğini oraya
 * anında yazıyor. Önce yetki girişte oturuma kopyalanıp 30 gün öyle
 * kalıyordu — Discord'da rolü alınan bir yetkili bir ay boyunca ban
 * atabiliyordu, yeni yetki verilen biri de çıkış yapıp girmeden hiçbir şey
 * göremiyordu.
 *
 * Tek sorgu: üyenin rolleri ve eşlemeler birleştirilerek okunuyor.
 */
export async function canliYetki(db: Db, discordId: string): Promise<ResolvedRoles> {
  const eslemeler = await db
    .select({
      systemRole: accessSchema.roleMappings.systemRole,
      panelPermissions: accessSchema.roleMappings.panelPermissions,
    })
    .from(accessSchema.discordMemberRoles)
    .innerJoin(
      accessSchema.roleMappings,
      eq(accessSchema.roleMappings.discordRoleId, accessSchema.discordMemberRoles.discordRoleId),
    )
    .where(eq(accessSchema.discordMemberRoles.discordId, discordId));

  return izinleriBirlestir(eslemeler);
}
