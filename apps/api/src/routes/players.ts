import { identitySchema, moderationSchema } from '@altai/db';
import type { Db } from '@altai/db';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../lib/auth-guard.js';

/**
 * Oyuncu arama ve profil — plan Bölüm 5 ("Oyuncu arama: pg_trgm ile kısmi
 * isim / SteamID / EOS ID araması").
 *
 * Aramanın zor yanı isim geçmişi: bir oyuncu 857.961 isim kaydının içinde
 * bugün kullanmadığı bir isimle aranabiliyor. Bu yüzden arama player_names
 * üzerinde yapılıp oyuncuya toplanıyor, sonuçta da eşleşen ismin kendisi
 * gösteriliyor ("bu oyuncu eskiden X adıyla oynuyordu").
 */

const SEARCH_LIMIT = 25;
const MIN_QUERY = 2;

export async function playerRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const guard = requireSession(opts.db, 'player.view');

  app.get<{ Querystring: { q?: string } }>(
    '/players/search',
    { preHandler: guard },
    async (req, reply) => {
      const q = (req.query.q ?? '').trim();
      if (q.length < MIN_QUERY) {
        return reply.code(400).send({ error: 'query_too_short', minLength: MIN_QUERY });
      }

      // Tam kimlik araması: kullanıcı SteamID/EOS yapıştırdıysa trigram'a
      // hiç gitmeden doğrudan bulunur (hem hızlı hem kesin).
      const looksLikeId = /^(7656119\d{10}|[0-9a-f]{32})$/i.test(q);
      if (looksLikeId) {
        const rows = await db
          .select({
            id: identitySchema.players.id,
            steamId: identitySchema.players.steamId,
            eosId: identitySchema.players.eosId,
          })
          .from(identitySchema.players)
          .where(
            or(
              eq(identitySchema.players.steamId, q),
              eq(identitySchema.players.eosId, q.toLowerCase()),
            ),
          )
          .limit(1);
        return { query: q, mode: 'identity', results: await decorate(db, rows) };
      }

      // İsim araması: pg_trgm benzerliği. `%` operatörü GIN indeksini
      // kullanıyor; similarity() ile sıralayıp en yakınları veriyoruz.
      const matches = await db.execute<{
        player_id: string;
        steam_id: string | null;
        eos_id: string | null;
        matched_name: string;
        score: number;
      }>(sql`
        select distinct on (p.id)
               p.id  as player_id,
               p.steam_id,
               p.eos_id,
               pn.name as matched_name,
               similarity(pn.name, ${q}) as score
        from player_names pn
        join players p on p.id = pn.player_id
        where pn.name % ${q}
        order by p.id, score desc
        limit ${SEARCH_LIMIT * 4}
      `);

      const rows = [...(matches as unknown as Array<Record<string, unknown>>)]
        .map((r) => ({
          id: String(r.player_id),
          steamId: (r.steam_id as string | null) ?? null,
          eosId: (r.eos_id as string | null) ?? null,
          matchedName: String(r.matched_name),
          score: Number(r.score),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, SEARCH_LIMIT);

      return { query: q, mode: 'name', results: await decorate(db, rows) };
    },
  );
}

interface BaseRow {
  id: string;
  steamId: string | null;
  eosId: string | null;
  matchedName?: string;
  score?: number;
}

/**
 * Arama sonucuna moderasyon bağlamı ekler.
 *
 * Bir admin listede önce "bu oyuncunun banı var mı" görmek istiyor; profile
 * girmeye zorlamak her aramayı iki adıma çıkarırdı.
 */
async function decorate(db: Db, rows: BaseRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  const names = await db
    .select({
      playerId: identitySchema.playerNames.playerId,
      name: identitySchema.playerNames.name,
    })
    .from(identitySchema.playerNames)
    .where(sql`${identitySchema.playerNames.playerId} = any(${ids})`)
    .orderBy(desc(identitySchema.playerNames.lastSeen))
    .limit(ids.length * 6);

  const latestName = new Map<string, string>();
  const nameCount = new Map<string, number>();
  for (const n of names) {
    if (!latestName.has(n.playerId)) latestName.set(n.playerId, n.name);
    nameCount.set(n.playerId, (nameCount.get(n.playerId) ?? 0) + 1);
  }

  const now = new Date();
  const bans = await db
    .select({ playerId: moderationSchema.bans.playerId })
    .from(moderationSchema.bans)
    .where(
      and(
        sql`${moderationSchema.bans.playerId} = any(${ids})`,
        isNull(moderationSchema.bans.revokedAt),
        or(
          isNull(moderationSchema.bans.expiresAt),
          sql`${moderationSchema.bans.expiresAt} > ${now}`,
        ),
      ),
    );
  const banned = new Set(bans.map((b) => b.playerId));

  return rows.map((r) => ({
    id: r.id,
    steamId: r.steamId,
    eosId: r.eosId,
    name: latestName.get(r.id) ?? r.matchedName ?? '(isim yok)',
    matchedName: r.matchedName ?? null,
    knownNames: nameCount.get(r.id) ?? 0,
    hasActiveBan: banned.has(r.id),
  }));
}
