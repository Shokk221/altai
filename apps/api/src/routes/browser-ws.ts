import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { listServerStates, onServerStateChange } from '../lib/server-state.js';

export async function browserWsRoutes(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket: WebSocket) => {
    // Bağlanır bağlanmaz mevcut durumun tamamı gönderilir (ilk yükleme için)
    socket.send(JSON.stringify({ type: 'snapshot', servers: listServerStates() }));

    const unsubscribe = onServerStateChange((slug, state) => {
      if (socket.readyState !== socket.OPEN) return;
      socket.send(JSON.stringify({ type: 'update', serverSlug: slug, state }));
    });

    socket.on('close', unsubscribe);
  });
}
