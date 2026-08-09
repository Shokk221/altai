import { accessSchema, identitySchema } from '@altai/db';
import type { Db } from '@altai/db';
import type { AppConfig } from '@altai/shared';
import { and, eq, isNotNull, isNull, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { formatAdminList } from '../lib/admin-list-format.js';
import { timingSafeCompare } from '../lib/timing-safe.js';

/**
 * Squad remote admin list — plan Bölüm 5.
 *
 * Zincir tek: Discord rolü -> role_mappings.squad_group -> Admins.cfg.
 * Discord'da rol alınan kişinin oyun içi yetkisi bir sonraki çekimde düşer.
 *
 * EMNİYET SUPABI: liste beklenenden az admin içeriyorsa SERVİS EDİLMEZ.
 * Bot rolleri senkronlamadıysa ya da senkron yarıda kaldıysa, boş bir liste
 * sunmak sunucudaki BÜTÜN adminlerin yetkisini bir anda düşürürdü. Bu
 * durumda 503 dönüyoruz; Squad son bilinen listeyi korur.
 */

export async function adminListRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig }) {
  const { db, config } = opts;
  // Kaç adminin altında liste "şüpheli" sayılır. 0 = kontrol kapalı.
  const minEntries = Number(process.env.ADMIN_LIST_MIN_ENTRIES ?? '1');

  app.get<{ Params: { token: string } }>('/admin-list/:token', async (req, reply) => {
    const token = req.params.token.replace(/\.cfg$/i, '');
    if (!config.ADMIN_LIST_TOKEN || !timingSafeCompare(token, config.ADMIN_LIST_TOKEN)) {
      return reply.code(404).type('text/plain; charset=utf-8').send('');
    }

    const groups = await db
      .select({
        name: accessSchema.squadAdminGroups.name,
        permissions: accessSchema.squadAdminGroups.permissions,
      })
      .from(accessSchema.squadAdminGroups);

    // Discord rolü -> squad grubu olan ve hesabını bağlamış oyuncular.
    const rows = await db
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

    const [syncRow] = await db
      .select({ last: max(accessSchema.discordMemberRoles.syncedAt) })
      .from(accessSchema.discordMemberRoles);

    const now = new Date();
    const result = formatAdminList({
      groups,
      entries: rows.map((r) => ({
        steamId: r.steamId,
        eosId: r.eosId,
        groupName: r.groupName ?? 'Admin',
      })),
      now,
      ...(syncRow?.last ? { rolesSyncedAt: syncRow.last } : {}),
    });

    if (minEntries > 0 && result.adminCount < minEntries) {
      // Sessizce boş liste servis etmektense açıkça hata dönmek doğru:
      // sunucu son bilinen listeyi korur, biz de log'da sebebini görürüz.
      req.log.error(
        { adminCount: result.adminCount, minEntries },
        'admin listesi şüpheli derecede kısa — SERVİS EDİLMEDİ',
      );
      return reply
        .code(503)
        .type('text/plain; charset=utf-8')
        .send(
          `// Admin listesi üretilemedi: yalnızca ${result.adminCount} kayıt bulundu ` +
            `(en az ${minEntries} bekleniyor).\n` +
            '// Discord rol senkronu çalışmıyor olabilir. Sunucu son listeyi korumalı.\n',
        );
    }

    return reply
      .type('text/plain; charset=utf-8')
      .header('cache-control', 'public, max-age=60')
      .send(result.body);
  });
}
