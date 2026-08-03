import type { AgentToApiMessage } from '@altai/contracts';
import { AgentToApiMessage as AgentToApiMessageSchema } from '@altai/contracts';
import type { Db } from '@altai/db';
import { presenceSchema } from '@altai/db';
import type { AppConfig } from '@altai/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import {
  applyPlayerConnected,
  applyPlayerDisconnected,
  applyServerSnapshot,
} from '../lib/server-state.js';

export async function agentWsRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig }) {
  const { db, config } = opts;

  app.get('/agent-ws', { websocket: true }, (socket: WebSocket) => {
    let authenticated = false;
    let serverSlug: string | null = null;

    socket.on('message', (raw: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const result = AgentToApiMessageSchema.safeParse(parsed);
      if (!result.success) return;
      const msg: AgentToApiMessage = result.data;

      if (msg.type === 'hello') {
        if (!config.AGENT_SHARED_SECRET || msg.secret !== config.AGENT_SHARED_SECRET) {
          socket.send(JSON.stringify({ type: 'hello_reject', reason: 'invalid_secret' }));
          socket.close();
          return;
        }
        authenticated = true;
        serverSlug = msg.serverSlug;
        app.log.info({ serverSlug }, 'agent uplink bağlandı');

        // servers tablosunda satırın var olduğunu doğrula (agent zaten kendi
        // tarafında oluşturuyor, burada sadece id'yi hello_ack'e koymak için okunuyor)
        void db
          .select()
          .from(presenceSchema.servers)
          .where(eq(presenceSchema.servers.slug, msg.serverSlug))
          .limit(1)
          .then(([row]) => {
            socket.send(JSON.stringify({ type: 'hello_ack', serverId: row?.id ?? 'unknown' }));
          });
        return;
      }

      if (!authenticated || !serverSlug) return;

      if (msg.type === 'event') {
        const event = msg.event;
        switch (event.type) {
          case 'PLAYER_CONNECTED':
            applyPlayerConnected(serverSlug, event.steamId, event.name, event.timestamp);
            break;
          case 'PLAYER_DISCONNECTED':
            applyPlayerDisconnected(serverSlug, event.steamId);
            break;
          case 'SERVER_SNAPSHOT':
            applyServerSnapshot(serverSlug, event.playerCount, event.queueCount, event.layer);
            break;
          case 'CHAT_MESSAGE':
            // Faz 3'te bot'a / admin cam benzeri özelliklere yönlendirilecek.
            break;
        }
      }

      // command_result: Faz 2/3'te kick/ban gibi komutların sonucunu
      // panelde göstermek için kullanılacak, şimdilik sadece loglanıyor.
      if (msg.type === 'command_result') {
        app.log.info({ result: msg.result }, 'agent komut sonucu döndürdü');
      }
    });

    socket.on('close', () => {
      if (serverSlug) app.log.warn({ serverSlug }, 'agent uplink koptu');
    });
  });
}
