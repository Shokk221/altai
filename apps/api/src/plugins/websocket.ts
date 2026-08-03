import fastifyWebsocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';

export async function registerWebsocket(app: FastifyInstance) {
  await app.register(fastifyWebsocket);
}
