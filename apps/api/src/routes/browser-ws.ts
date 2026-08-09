import type { Db } from '@altai/db';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { requireSession } from '../lib/auth-guard.js';
import { listServerStates, onServerStateChange } from '../lib/server-state.js';

/**
 * Tarayıcıya canlı yayın. Oyuncu isimleri ve SteamID'leri aktığı için
 * kimlik doğrulaması zorunlu.
 *
 * Kontrol WebSocket el sıkışmasında (preValidation) yapılıyor: el sıkışma
 * normal bir HTTP isteği, yani cookie orada okunabiliyor. Bağlantı kurulduktan
 * sonra reddetmek çok geç olurdu — ilk snapshot mesajı zaten gitmiş olurdu.
 */
export async function browserWsRoutes(app: FastifyInstance, opts: { db: Db }) {
  const guard = requireSession(opts.db, 'player.view');

  app.get('/ws', { websocket: true, preValidation: guard }, (socket: WebSocket) => {
    // Bağlanır bağlanmaz mevcut durumun tamamı gönderilir (ilk yükleme için)
    socket.send(JSON.stringify({ type: 'snapshot', servers: listServerStates() }));

    const unsubscribe = onServerStateChange((slug, state) => {
      if (socket.readyState !== socket.OPEN) return;
      socket.send(JSON.stringify({ type: 'update', serverSlug: slug, state }));
    });

    socket.on('close', unsubscribe);
  });
}
