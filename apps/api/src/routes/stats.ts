import type { Db } from '@altai/db';
import type { FastifyInstance } from 'fastify';
import { oyuncuIstatistiginiGetir, siralama } from '../lib/agent-queries.js';
import { requireSession } from '../lib/auth-guard.js';

/**
 * İstatistik uçları — plan Faz 4 (istatistik/leaderboard).
 *
 * Hesaplama `agent-queries.ts`'te, çünkü aynı sorulara oyun içinden
 * (`!stats`) ve panelden aynı cevabın gelmesi gerekiyor. Eski sistemde iki
 * ayrı yol vardı ve sayılar ayrışabiliyordu; hangisinin doğru olduğunu
 * kimse bilmiyordu.
 */

const UUID = /^[0-9a-f-]{36}$/i;
const OLCUTLER = ['kills', 'kdr', 'revives', 'rounds'] as const;
type Olcut = (typeof OLCUTLER)[number];

/** `days` parametresini okur. Yok/0/geçersiz = tüm zamanlar (null). */
function gunOku(ham: string | undefined): number | null {
  if (ham === undefined || ham === '') return null;
  const n = Number(ham);
  if (!Number.isInteger(n) || n <= 0 || n > 3650) return null;
  return n;
}

export async function statsRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const guard = requireSession(opts.db, 'player.view');

  app.get<{ Params: { id: string }; Querystring: { days?: string } }>(
    '/players/:id/stats',
    { preHandler: guard },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) {
        return reply.code(400).send({ error: 'gecersiz_oyuncu_id' });
      }
      const ist = await oyuncuIstatistiginiGetir(db, req.params.id, gunOku(req.query.days));
      // 404 DÖNMÜYOR: oyuncu var ama hiç maç bitirmemiş olabilir ve bu bir
      // hata değil, bir cevap. `bulundu: false` ile sıfırlar dönüyor,
      // panel de "henüz maç yok" diye gösteriyor.
      return ist;
    },
  );

  app.get<{
    Querystring: { metric?: string; limit?: string; days?: string; minRounds?: string };
  }>('/stats/leaderboard', { preHandler: guard }, async (req, reply) => {
    const metric = (req.query.metric ?? 'kills') as Olcut;
    if (!OLCUTLER.includes(metric)) {
      return reply.code(400).send({ error: 'gecersiz_olcut', kabul: OLCUTLER });
    }

    const limitHam = Number(req.query.limit ?? 25);
    const limit = Number.isInteger(limitHam) ? Math.min(Math.max(limitHam, 1), 25) : 25;

    const minHam = Number(req.query.minRounds ?? 0);
    // K/D sıralamasında varsayılan eşik SIFIR DEĞİL: tek maçlık bir K/D,
    // sıralamanın tepesini anlamsız kılar. Panelden açıkça 0 verilebilir.
    const varsayilanEsik = metric === 'kdr' ? 10 : 0;
    const minRounds =
      req.query.minRounds !== undefined && Number.isInteger(minHam) && minHam >= 0
        ? Math.min(minHam, 1000)
        : varsayilanEsik;

    return siralama(db, {
      kind: 'leaderboard',
      metric,
      limit,
      days: gunOku(req.query.days),
      minRounds,
    });
  });
}
