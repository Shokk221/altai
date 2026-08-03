import type { FastifyInstance } from 'fastify';
import { getServerState, listServerStates } from '../lib/server-state.js';

export async function serverStatusRoutes(app: FastifyInstance) {
  app.get('/servers', async () => ({ servers: listServerStates() }));

  app.get<{ Params: { slug: string } }>('/servers/:slug', async (req, reply) => {
    const state = getServerState(req.params.slug);
    if (!state) return reply.code(404).send({ error: 'server_not_found' });
    return state;
  });
}
