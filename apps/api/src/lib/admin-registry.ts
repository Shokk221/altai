import { accessSchema, identitySchema, presenceSchema } from '@altai/db';
import type { Db } from '@altai/db';
import { and, eq, gt, isNotNull, isNull, max, or } from 'drizzle-orm';
import type { AdminEntry, AdminGroupDef } from './admin-list-format.js';

/**
 * Yetki zincirinin okunması — Admins.cfg'yi de agent'a gidecek listeyi de
 * bu üretir.
 *
 * Önce yalnızca `routes/admin-list.ts` içinde satır içi duruyordu. Agent'a
 * da aynı bilginin gitmesi gerekince (plugin'lerin "admini muaf tut"
 * kontrolü için) sorgunun kopyalanması gündeme geldi; kopyalansaydı iki
 * liste zamanla ayrışır ve oyun içi yetki ile plugin muafiyeti birbirini
 * tutmazdı — yani admin, kendi yetkisinin görünmediği bir plugin
 * tarafından cezalandırılırdı.
 *
 * İki kaynak bilinçli olarak ayrı (plan Bölüm 5):
 *   YETKİLİ gruplar yalnızca Discord'dan gelir,
 *   WHITELIST grupları elle verilir.
 */

export interface AdminRegistry {
  groups: AdminGroupDef[];
  entries: AdminEntry[];
  /** Yetkili (grant_mode='discord') gruba giren kayıt sayısı — emniyet kontrolü. */
  adminEntries: number;
  /** Yetkili gruba elle verilmiş, bu yüzden REDDEDİLEN grant sayısı. */
  rejectedGrants: number;
  /** Oyun içi gruba eşlenmiş Discord rolü sayısı. */
  mappingCount: number;
  rolesSyncedAt?: Date | undefined;
}

/**
 * @param serverId null ise yalnızca küresel (server_id NULL) kayıtlar.
 */
export async function adminKayitlari(db: Db, serverId: string | null): Promise<AdminRegistry> {
  /** Kayıt bu sunucu için geçerli mi: küresel (NULL) ya da tam eşleşme. */
  const buSunucuIcin = (kolon: Parameters<typeof isNull>[0]) =>
    serverId ? or(isNull(kolon), eq(kolon, serverId)) : isNull(kolon);

  const groups = await db
    .select({
      name: accessSchema.squadAdminGroups.name,
      permissions: accessSchema.squadAdminGroups.squadPermissions,
      grantMode: accessSchema.squadAdminGroups.grantMode,
    })
    .from(accessSchema.squadAdminGroups)
    .where(buSunucuIcin(accessSchema.squadAdminGroups.serverId));

  const modeByGroup = new Map(groups.map((g) => [g.name, g.grantMode]));

  // --- 1) Discord zincirinden gelen YETKİLİ üyeler ---
  const discordRows = await db
    .select({
      steamId: identitySchema.players.steamId,
      eosId: identitySchema.players.eosId,
      groupName: accessSchema.roleMappings.squadGroup,
    })
    .from(accessSchema.discordMemberRoles)
    .innerJoin(
      accessSchema.roleMappings,
      eq(accessSchema.roleMappings.discordRoleId, accessSchema.discordMemberRoles.discordRoleId),
    )
    .innerJoin(
      accessSchema.discordLinks,
      eq(accessSchema.discordLinks.discordId, accessSchema.discordMemberRoles.discordId),
    )
    .innerJoin(
      identitySchema.players,
      eq(identitySchema.players.id, accessSchema.discordLinks.playerId),
    )
    .where(
      and(
        isNotNull(accessSchema.roleMappings.squadGroup),
        isNull(accessSchema.discordLinks.unlinkedAt),
      ),
    );

  // --- 2) Elle verilmiş grant'lardan gelen WHITELIST üyeleri ---
  const now = new Date();
  const grantRows = await db
    .select({
      steamId: identitySchema.players.steamId,
      eosId: identitySchema.players.eosId,
      groupName: accessSchema.grants.groupName,
      comment: accessSchema.grants.comment,
    })
    .from(accessSchema.grants)
    .innerJoin(identitySchema.players, eq(identitySchema.players.id, accessSchema.grants.playerId))
    .where(
      and(
        isNull(accessSchema.grants.revokedAt),
        or(isNull(accessSchema.grants.expiresAt), gt(accessSchema.grants.expiresAt, now)),
        buSunucuIcin(accessSchema.grants.serverId),
      ),
    );

  const entries: AdminEntry[] = [];
  let adminEntries = 0;
  let rejectedGrants = 0;

  for (const r of discordRows) {
    const group = r.groupName ?? 'Admin';
    // Discord rolü whitelist grubuna eşlenmişse de kabul: kısıt tersine
    // (elle yetkili grup verilmesine) karşı.
    entries.push({ steamId: r.steamId, eosId: r.eosId, groupName: group });
    if (modeByGroup.get(group) === 'discord') adminEntries++;
  }

  for (const r of grantRows) {
    if (modeByGroup.get(r.groupName) === 'discord') {
      // Yetkili grup elle verilemez. Sayılıyor çünkü bu bir yapılandırma
      // hatası ve görünmesi gerekiyor.
      rejectedGrants++;
      continue;
    }
    entries.push({
      steamId: r.steamId,
      eosId: r.eosId,
      groupName: r.groupName,
      ...(r.comment ? { label: r.comment } : {}),
    });
  }

  const [syncRow] = await db
    .select({ last: max(accessSchema.discordMemberRoles.syncedAt) })
    .from(accessSchema.discordMemberRoles);

  // Kaç Discord rolü oyun içi gruba eşlenmiş? Hiç eşleme yoksa sistem henüz
  // kurulmamış demektir; eşleme varsa ama admin çıkmıyorsa senkron bozuk
  // demektir. İkisi çok farklı durumlar.
  const mappings = await db
    .select({ id: accessSchema.roleMappings.id })
    .from(accessSchema.roleMappings)
    .where(isNotNull(accessSchema.roleMappings.squadGroup));

  return {
    groups,
    entries,
    adminEntries,
    rejectedGrants,
    mappingCount: mappings.length,
    ...(syncRow?.last ? { rolesSyncedAt: syncRow.last } : {}),
  };
}

/** slug -> sunucu UUID'si. Bilinmeyen slug için null. */
export async function serverIdBySlug(db: Db, slug: string): Promise<string | null> {
  const [srv] = await db
    .select({ id: presenceSchema.servers.id })
    .from(presenceSchema.servers)
    .where(eq(presenceSchema.servers.slug, slug))
    .limit(1);
  return srv?.id ?? null;
}
