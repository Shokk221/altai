import { createDb } from '@altai/db';
import { loadConfig, logger } from '@altai/shared';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { registerDiscordOAuth } from './plugins/discord-oauth.js';
import { registerWebsocket } from './plugins/websocket.js';
import { agentWsRoutes } from './routes/agent-ws.js';
import { authRoutes } from './routes/auth.js';
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
await app.register(browserWsRoutes);
await app.register(serverStatusRoutes);

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: '0.0.0.0' }).then(() => {
  logger.info(`api ${config.NODE_ENV} modunda :${port} portunda`);
});
