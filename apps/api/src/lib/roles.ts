import { type Permission, SYSTEM_ROLES, type SystemRole } from '@altai/contracts';
import type { Db } from '@altai/db';
import { accessSchema, identitySchema } from '@altai/db';
import { inArray } from 'drizzle-orm';

export interface ResolvedRoles {
  systemRole: SystemRole;
  permissions: Permission[];
}

// Discord'daki bir kullanıcının rol ID listesini alır, role_mappings tablosunda
// eşleşenleri bulur, izinleri birleştirir ve en yüksek yetkili sistem rolünü döner.
// Eşleşme yoksa en düşük rol (member, boş izin) döner — panelden hiçbir şey
// yapamaz ama giriş yapabilir.
export async function resolveRoles(db: Db, discordRoleIds: string[]): Promise<ResolvedRoles> {
  if (discordRoleIds.length === 0) {
    return { systemRole: 'member', permissions: [] };
  }

  const mappings = await db
    .select()
    .from(accessSchema.roleMappings)
    .where(inArray(accessSchema.roleMappings.discordRoleId, discordRoleIds));

  if (mappings.length === 0) {
    return { systemRole: 'member', permissions: [] };
  }

  const permissionSet = new Set<Permission>();
  let bestRoleIndex = SYSTEM_ROLES.length - 1; // en düşük öncelik

  for (const mapping of mappings) {
    for (const perm of mapping.panelPermissions) permissionSet.add(perm as Permission);

    const idx = SYSTEM_ROLES.indexOf(mapping.systemRole as SystemRole);
    if (idx !== -1 && idx < bestRoleIndex) bestRoleIndex = idx;
  }

  return {
    systemRole: SYSTEM_ROLES[bestRoleIndex] ?? 'member',
    permissions: [...permissionSet],
  };
}
