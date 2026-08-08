import { timingSafeEqual } from 'node:crypto';
import type { Db } from '@altai/db';
import { identitySchema, moderationSchema, presenceSchema } from '@altai/db';
import type { AppConfig } from '@altai/shared';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { formatBanList } from '../lib/ban-list-format.js';

/**
 * Squad remote ban list — plan Bölüm 5'teki "kritik hile".
 *
 * Ban dosyasını sunucuya İTMEK yerine, sunucu bizden ÇEKİYOR: Squad'ın
 * yerleşik RemoteBanListHosts.cfg özelliği bu adrese periyodik GET atıyor.
 * Böylece SFTP, dosya yazma ve senkron sorunu tarihe karışıyor; ban
 * atıldığı anda listede oluyor.
 *
 * Kimlik doğrulama URL'deki token ile: Squad düz bir HTTP GET yapıyor,
 * header ekleyemiyoruz.
 */

/** Uzunluk sızdırmayan, zamanlama saldırısına kapalı karşılaştırma. */
function tokenMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function banListRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig }) {
  const { db, config } = opts;

  app.get<{ Params: { token: string }; Querystring: { server?: string } }>(
    '/ban-list/:token',
    async (req, reply) => {
      // Squad örneklerinde adres .cfg ile bitiyor; iki biçimi de kabul et.
      const token = req.params.token.replace(/\.cfg$/i, '');

      if (!config.BAN_LIST_TOKEN || !tokenMatches(token, config.BAN_LIST_TOKEN)) {
        // 403 yerine 404: yanlış token, ucun var olduğunu bile öğrenmesin.
        return reply.code(404).type('text/plain; charset=utf-8').send('');
      }

      const now = new Date();

      // Aktif ban = kaldırılmamış VE (kalıcı VEYA süresi dolmamış).
      const active = and(
        isNull(moderationSchema.bans.revokedAt),
        or(isNull(moderationSchema.bans.expiresAt), gt(moderationSchema.bans.expiresAt, now)),
      );

      // Sunucu filtresi: serverId NULL olan banlar tüm sunucularda geçerli
      // (BM'deki orgWide karşılığı), diğerleri yalnızca kendi sunucusunda.
      const slug = req.query.server;
      let where = active;
      if (slug) {
        const [server] = await db
          .select({ id: presenceSchema.servers.id })
          .from(presenceSchema.servers)
          .where(eq(presenceSchema.servers.slug, slug))
          .limit(1);
        if (!server) return reply.code(404).type('text/plain; charset=utf-8').send('');
        where = and(
          active,
          or(isNull(moderationSchema.bans.serverId), eq(moderationSchema.bans.serverId, server.id)),
        ) as typeof active;
      }

      const rows = await db
        .select({
          steamId: identitySchema.players.steamId,
          eosId: identitySchema.players.eosId,
          reason: moderationSchema.bans.reason,
          expiresAt: moderationSchema.bans.expiresAt,
        })
        .from(moderationSchema.bans)
        .innerJoin(
          identitySchema.players,
          eq(moderationSchema.bans.playerId, identitySchema.players.id),
        )
        .where(where);

      const body = formatBanList({
        entries: rows,
        now,
        ...(slug ? { label: slug } : {}),
      });

      return (
        reply
          .type('text/plain; charset=utf-8')
          // Squad periyodik çekiyor; kısa önbellek hem bizi hem sunucuyu korur.
          .header('cache-control', 'public, max-age=60')
          .send(body)
      );
    },
  );
}
