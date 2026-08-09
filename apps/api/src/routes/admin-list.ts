import { accessSchema, identitySchema } from '@altai/db';
import type { Db } from '@altai/db';
import type { AppConfig } from '@altai/shared';
import { and, eq, gt, isNotNull, isNull, max, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { type AdminEntry, formatAdminList } from '../lib/admin-list-format.js';
import { timingSafeCompare } from '../lib/timing-safe.js';

/**
 * Squad remote admin list — plan Bölüm 5.
 *
 * İki ayrı kaynak, bilinçli olarak ayrı tutuluyor:
 *
 *  YETKİLİ GRUPLAR (kick/ban/cheat...) yalnızca DISCORD'dan gelir.
 *    discord_member_roles -> role_mappings.squad_group -> Admins.cfg
 *    Discord'da rol alınınca oyun içi yetki de düşer. Elle admin ekleme
 *    yolu YOK — iki paralel yetki mekanizması eski sistemin hatasıydı.
 *
 *  WHITELIST GRUPLARI (yalnızca `reserve`) elle verilir.
 *    grants -> Admins.cfg
 *    Klan üyesi ya da bağışçı olan birinin Discord'da bulunması gerekmiyor.
 *
 * Karışmaları engelli: elle verilmiş bir grant yetkili bir gruba yazamaz
 * (grup grant_mode='discord' ise atlanır ve loglanır).
 */

export async function adminListRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig }) {
  const { db, config } = opts;

  app.get<{ Params: { token: string } }>('/admin-list/:token', async (req, reply) => {
    const token = req.params.token.replace(/\.cfg$/i, '');
    if (!config.ADMIN_LIST_TOKEN || !timingSafeCompare(token, config.ADMIN_LIST_TOKEN)) {
      return reply.code(404).type('text/plain; charset=utf-8').send('');
    }

    const groups = await db
      .select({
        name: accessSchema.squadAdminGroups.name,
        permissions: accessSchema.squadAdminGroups.permissions,
        grantMode: accessSchema.squadAdminGroups.grantMode,
      })
      .from(accessSchema.squadAdminGroups);

    const modeByGroup = new Map(groups.map((g) => [g.name, g.grantMode]));

    // --- 1) Discord zincirinden gelen YETKİLİ üyeler ---
    const discordRows = await db
      .select({
        steamId: identitySchema.players.steamId,
        eosId: identitySchema.players.eosId,
        groupName: identitySchema.roleMappings.squadGroup,
      })
      .from(accessSchema.discordMemberRoles)
      .innerJoin(
        identitySchema.roleMappings,
        eq(
          identitySchema.roleMappings.discordRoleId,
          accessSchema.discordMemberRoles.discordRoleId,
        ),
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
          isNotNull(identitySchema.roleMappings.squadGroup),
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
      .innerJoin(
        identitySchema.players,
        eq(identitySchema.players.id, accessSchema.grants.playerId),
      )
      .where(
        and(
          isNull(accessSchema.grants.revokedAt),
          or(isNull(accessSchema.grants.expiresAt), gt(accessSchema.grants.expiresAt, now)),
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
        // Yetkili grup elle verilemez. Sessizce atlamak yerine sayıyoruz:
        // bu bir yapılandırma hatası ve görünmesi gerekiyor.
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

    if (rejectedGrants > 0) {
      req.log.warn(
        { rejectedGrants },
        'yetkili gruba elle verilmiş grant atlandı — admin yetkisi yalnızca Discord üzerinden',
      );
    }

    const [syncRow] = await db
      .select({ last: max(accessSchema.discordMemberRoles.syncedAt) })
      .from(accessSchema.discordMemberRoles);

    // Kaç Discord rolü oyun içi gruba eşlenmiş? Hiç eşleme yoksa sistem
    // henüz kurulmamış demektir; eşleme varsa ama admin çıkmıyorsa senkron
    // bozuk demektir. İkisi çok farklı durumlar.
    const mappings = await db
      .select({ id: identitySchema.roleMappings.id })
      .from(identitySchema.roleMappings)
      .where(isNotNull(identitySchema.roleMappings.squadGroup));

    const result = formatAdminList({
      groups,
      entries,
      now,
      ...(syncRow?.last ? { rolesSyncedAt: syncRow.last } : {}),
    });

    // EMNİYET SUPABI — yalnızca ADMIN sayısına bakar. Whitelist kayıtları
    // dolu olsa bile adminler kaybolmuşsa liste servis edilmemeli.
    // Eşleme hiç tanımlanmamışsa bu beklenen bir durum, hata değil.
    if (mappings.length > 0 && adminEntries === 0) {
      req.log.error(
        { mappings: mappings.length, adminEntries },
        'rol eşlemesi var ama hiç admin çıkmadı — liste SERVİS EDİLMEDİ',
      );
      return reply
        .code(503)
        .type('text/plain; charset=utf-8')
        .send(
          '// Admin listesi üretilemedi: rol eşlemesi tanımlı ama hiç admin bulunamadı.\n' +
            '// Discord rol senkronu çalışmıyor olabilir. Sunucu son listeyi korumalı.\n',
        );
    }

    return reply
      .type('text/plain; charset=utf-8')
      .header('cache-control', 'public, max-age=60')
      .send(result.body);
  });
}
