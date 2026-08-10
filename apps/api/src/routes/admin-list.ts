import { accessSchema, identitySchema, presenceSchema } from '@altai/db';
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
 *
 * SUNUCU FİLTRESİ: `?server=<slug>`. Hem gruplar hem grant'lar sunucuya
 * bağlanabiliyor (`server_id`); NULL = tüm sunucular. Filtre verilmezse
 * yalnızca küresel kayıtlar döner — çünkü sunucuya özel bir whitelist'in
 * başka bir sunucuya sızması, sızmaması gerekenden daha kötü. Ban listesi
 * ucu da aynı mantığı kullanıyor.
 */

export async function adminListRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig }) {
  const { db, config } = opts;

  app.get<{ Params: { token: string }; Querystring: { server?: string } }>(
    '/admin-list/:token',
    async (req, reply) => {
      const token = req.params.token.replace(/\.cfg$/i, '');
      if (!config.ADMIN_LIST_TOKEN || !timingSafeCompare(token, config.ADMIN_LIST_TOKEN)) {
        return reply.code(404).type('text/plain; charset=utf-8').send('');
      }

      // Sunucu çözümlemesi: bilinmeyen slug 404 — yanlış yazılmış bir slug
      // sessizce "tüm sunucular" listesine düşerse yetki sızar.
      const slug = req.query.server;
      let serverId: string | null = null;
      if (slug) {
        const [srv] = await db
          .select({ id: presenceSchema.servers.id })
          .from(presenceSchema.servers)
          .where(eq(presenceSchema.servers.slug, slug))
          .limit(1);
        if (!srv) return reply.code(404).type('text/plain; charset=utf-8').send('');
        serverId = srv.id;
      }

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
          eq(
            accessSchema.roleMappings.discordRoleId,
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
        .innerJoin(
          identitySchema.players,
          eq(identitySchema.players.id, accessSchema.grants.playerId),
        )
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
        .select({ id: accessSchema.roleMappings.id })
        .from(accessSchema.roleMappings)
        .where(isNotNull(accessSchema.roleMappings.squadGroup));

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
    },
  );
}
