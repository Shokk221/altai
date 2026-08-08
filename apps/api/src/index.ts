import { createDb } from '@altai/db';
import { loadConfig, logger } from '@altai/shared';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { registerDiscordOAuth } from './plugins/discord-oauth.js';
import { registerWebsocket } from './plugins/websocket.js';
import { agentWsRoutes } from './routes/agent-ws.js';
import { authRoutes } from './routes/auth.js';
import { banListRoutes } from './routes/ban-list.js';
import { browserWsRoutes } from './routes/browser-ws.js';
import { healthRoutes } from './routes/health.js';
import { serverStatusRoutes } from './routes/server-status.js';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

// Not: Fastify kendi pino tabanlı logger'ını kurar; @altai/shared logger'ı
// agent/bot/tools gibi Fastify dışı süreçlerde kullanılır.
const app = Fastify({ logger: true });

await app.register(cookie);
await app.register(cors, {
  origin: config.WEB_APP_URL ?? 'http://localhost:3000',
  credentials: true,
});
await registerWebsocket(app);
await registerDiscordOAuth(app, config);
await app.register(healthRoutes);
await app.register(authRoutes, { db, config });
await app.register(agentWsRoutes, { db, config });
await app.register(banListRoutes, { db, config });
await app.register(browserWsRoutes);
await app.register(serverStatusRoutes);

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: '0.0.0.0' }).then(() => {
  logger.info(`api ${config.NODE_ENV} modunda :${port} portunda`);
});

// Düzgün kapanış zorunlu: kalıcı yazım artık api'de ve raw_events 2 saniyelik
// batch'ler hâlinde gidiyor. app.close() çağrılmazsa onClose kancası (dolayısıyla
// writer.stop()) hiç çalışmaz ve her restart'ta son batch sessizce kaybolur.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'api kapanıyor, bekleyen yazımlar boşaltılıyor');
  try {
    await app.close();
  } catch (err) {
    logger.error({ err }, 'kapanışta hata');
  }
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
