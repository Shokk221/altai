import type { Db } from '@altai/db';
import { presenceSchema } from '@altai/db';
import type { FastifyInstance } from 'fastify';
import { agentBagliMi, komutGonder } from '../lib/agent-command-bus.js';
import { requireSession } from '../lib/auth-guard.js';

/**
 * Agent bağlantı durumu ve komut kanalı sağlık kontrolü.
 *
 * İki soruyu cevaplar:
 *  1. Hangi sunucunun agent'ı bağlı? (Ban attığımızda oyuncu anında
 *     atılabilecek mi, yoksa yalnızca ban listesine mi yazılacak?)
 *  2. Kanal gerçekten çalışıyor mu? `?ping=1` uçtan uca bir gidiş-dönüş
 *     yapar — ama oyuna DOKUNMAZ, agent RCON'a hiç gitmeden cevaplar.
 *
 * Ping'in var olma sebebi: bu olmadan kanalı sınamanın tek yolu canlı
 * sunucuda gerçek bir oyuncuyu atmaktı.
 */
export async function agentRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  app.get<{ Querystring: { ping?: string } }>(
    '/agents',
    { preHandler: requireSession(db, 'player.view') },
    async (req) => {
      const sunucular = await db
        .select({ id: presenceSchema.servers.id, slug: presenceSchema.servers.slug })
        .from(presenceSchema.servers)
        .orderBy(presenceSchema.servers.slug);

      const pingIstendi = req.query.ping === '1';
      const actor = req.authSession?.id ?? 'sistem';

      const sonuc = [];
      for (const s of sunucular) {
        const bagli = agentBagliMi(s.slug);
        if (!bagli || !pingIstendi) {
          sonuc.push({ slug: s.slug, bagli, ping: null });
          continue;
        }
        const basla = Date.now();
        const cevap = await komutGonder(s.slug, 'ping', {}, actor);
        sonuc.push({
          slug: s.slug,
          bagli,
          ping: { durum: cevap.durum, ms: Date.now() - basla },
        });
      }

      return { agents: sonuc };
    },
  );
}
