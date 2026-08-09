import type { Db } from '@altai/db';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../lib/auth-guard.js';
import { getServerState, listServerStates } from '../lib/server-state.js';

/**
 * Canlı sunucu durumu. Oyuncu isimleri ve SteamID'leri içerdiği için
 * KİMLİK DOĞRULAMASI ZORUNLU — bu uçlar başta herkese açıktı.
 */
export async function serverStatusRoutes(app: FastifyInstance, opts: { db: Db }) {
  const guard = requireSession(opts.db, 'player.view');

  app.get('/servers', { preHandler: guard }, async () => ({ servers: listServerStates() }));

  app.get<{ Params: { slug: string } }>(
    '/servers/:slug',
    { preHandler: guard },
    async (req, reply) => {
      const state = getServerState(req.params.slug);
      if (!state) return reply.code(404).send({ error: 'server_not_found' });
      return state;
    },
  );
}
