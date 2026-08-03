import type { AgentEvent, ApiToAgentMessage } from '@altai/contracts';
import { ApiToAgentMessage as ApiToAgentMessageSchema } from '@altai/contracts';
import { logger } from '@altai/shared';
import WebSocket from 'ws';

export interface UplinkOptions {
  url: string;
  serverSlug: string;
  secret: string;
  onCommand: (message: Extract<ApiToAgentMessage, { type: 'command' }>) => void;
}

export interface Uplink {
  send(event: AgentEvent): void;
  close(): void;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function createUplink(opts: UplinkOptions): Uplink {
  let ws: WebSocket | undefined;
  let closed = false;
  let reconnectDelay = RECONNECT_BASE_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function connect() {
    if (closed) return;
    ws = new WebSocket(opts.url);

    ws.on('open', () => {
      reconnectDelay = RECONNECT_BASE_MS;
      logger.info({ url: opts.url }, 'api uplink bağlandı, hello gönderiliyor');
      ws?.send(JSON.stringify({ type: 'hello', serverSlug: opts.serverSlug, secret: opts.secret }));
    });

    ws.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const result = ApiToAgentMessageSchema.safeParse(parsed);
      if (!result.success) return;

      const msg = result.data;
      if (msg.type === 'hello_ack') {
        logger.info({ serverId: msg.serverId }, 'api uplink kimlik doğrulandı');
      } else if (msg.type === 'hello_reject') {
        logger.error(
          { reason: msg.reason },
          'api uplink reddedildi — AGENT_SHARED_SECRET kontrol et',
        );
      } else if (msg.type === 'command') {
        opts.onCommand(msg);
      }
    });

    ws.on('close', () => {
      if (closed) return;
      logger.warn({ delayMs: reconnectDelay }, 'api uplink koptu, yeniden bağlanılacak');
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    });

    ws.on('error', (err) => {
      logger.error({ err }, 'api uplink hatası');
    });
  }

  connect();

  return {
    send(event) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'event', event }));
      }
      // Bağlantı kopuksa event burada kaybolur — kalıcı veri zaten
      // PersistenceWriter ile doğrudan Postgres'e yazıldığı için (Bölüm 3),
      // uplink sadece gerçek zamanlı yayın içindir, veri kaybı değildir.
    },
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
