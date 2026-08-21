import { createDb } from '@altai/db';
import { loadConfig, logger } from '@altai/shared';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyError, type FastifyServerOptions } from 'fastify';
import { activityLogBaslat, activityLogDurdur, kaydet } from './lib/activity-log.js';
import { redactedRequestSerializer } from './lib/log-redact.js';
import { registerActivityLog } from './plugins/activity.js';
import { registerDiscordOAuth } from './plugins/discord-oauth.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { registerWebsocket } from './plugins/websocket.js';
import { accessAdminRoutes } from './routes/access-admin.js';
import { activityRoutes } from './routes/activity.js';
import { adminCamRoutes } from './routes/admin-cam.js';
import { adminListRoutes } from './routes/admin-list.js';
import { agentWsRoutes } from './routes/agent-ws.js';
import { agentRoutes } from './routes/agents.js';
import { authRoutes } from './routes/auth.js';
import { banListRoutes } from './routes/ban-list.js';
import { browserWsRoutes } from './routes/browser-ws.js';
import { clanWarRoutes } from './routes/clan-wars.js';
import { clanRoutes } from './routes/clans.js';
import { healthRoutes } from './routes/health.js';
import { liveActionRoutes } from './routes/live-actions.js';
import { moderationRoutes } from './routes/moderation.js';
import { playerRoutes } from './routes/players.js';
import { pluginConfigRoutes } from './routes/plugin-configs.js';
import { ruleRoutes } from './routes/rules.js';
import { serverStatusRoutes } from './routes/server-status.js';
import { statsRoutes } from './routes/stats.js';
import { ticketRoutes } from './routes/tickets.js';

const config = loadConfig();
const db = createDb(config.DATABASE_URL);

// Not: Fastify kendi pino tabanlı logger'ını kurar; @altai/shared logger'ı
// agent/bot/tools gibi Fastify dışı süreçlerde kullanılır.
// Seçenekler açıkça tipleniyor: satır içi verildiğinde TypeScript sunucu
// tipini Http2SecureServer olarak çıkarsıyor ve tüm register() çağrıları
// uyumsuz hale geliyor.
/**
 * TRUST_PROXY'yi Fastify'ın beklediği biçime çevir.
 *
 * Vekil arkasında değilsek KAPALI kalmalı: açıkken Fastify req.ip'yi
 * X-Forwarded-For'dan okur ve doğrudan erişilebilen bir sunucuda istemci
 * kendi IP'sini uydurup hız sınırını tamamen atlayabilir.
 */
function resolveTrustProxy(value: string | undefined): boolean | string {
  if (!value) return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value; // 'loopback', bir IP ya da CIDR listesi
}

const serverOptions: FastifyServerOptions = {
  logger: {
    // Varsayılan serileştirici req.url'i olduğu gibi yazıyor; ban ve admin
    // listesi token'ları URL'de taşındığı için her istekte loga düşüyordu
    // (gerçek kurulumda doğrulandı). Maskeleniyor.
    serializers: { req: redactedRequestSerializer },
  },
  // Hız sınırı istemciyi req.ip ile ayırt ediyor; vekil arkasında bu ayar
  // olmadan herkes tek kovaya düşer (bkz. plugins/rate-limit.ts).
  trustProxy: resolveTrustProxy(config.TRUST_PROXY),
};
const app = Fastify(serverOptions);

// Günlük yazıcısı rotalardan ÖNCE ayağa kalkıyor: açılış olayının kendisi
// de kayda düşsün istiyoruz.
activityLogBaslat(db);
registerActivityLog(app);

// Beklenmeyen hatalar: gerçek sebep loglanır, istemciye genel mesaj döner.
// Fastify varsayılanı hata mesajını olduğu gibi gönderiyor ve bu iç detay
// (SQL, dosya yolu) sızdırabilir.
app.setErrorHandler((error: FastifyError, req, reply) => {
  const status = error.statusCode ?? 500;
  if (status >= 500) {
    req.log.error({ err: error }, 'işlenmemiş hata');
    return reply.code(status).send({ error: 'internal_error' });
  }
  return reply.code(status).send({ error: error.code ?? 'request_error', message: error.message });
});

await app.register(cookie);
await registerRateLimit(app);
await app.register(cors, {
  origin: config.WEB_APP_URL ?? 'http://localhost:3000',
  credentials: true,
});
await registerWebsocket(app);

/**
 * Rota önekleri, panelin önündeki ters vekilin yönlendirmesine göre.
 *
 *   /            -> web (3000)
 *   /api/*       -> api (3001)   ÖNEK SOYULMADAN geliyor
 *   /ws          -> api (3001)
 *   /agent-ws    -> api (3001)
 *
 * Vekil `/api` önekini kesmiyor; api'ye `/api/health` olarak ulaşıyor.
 * Bu yüzden HTTP rotaları burada `/api` altına kaydediliyor. WebSocket
 * rotaları vekilde ayrı ve öneksiz tanımlı, o yüzden kökte kalıyorlar —
 * onlara önek eklemek bağlantıyı koparırdı.
 *
 * Ban ve admin listesi de `/api` altında: vekil tablosunda ayrı bir giriş
 * yok, kökte bırakılsalardı istek web uygulamasına düşerdi ve Squad
 * sunucusu listeleri hiç alamazdı.
 */
await app.register(
  async (api) => {
    await registerDiscordOAuth(api, config);
    await api.register(healthRoutes);
    await api.register(authRoutes, { db, config });
    await api.register(banListRoutes, { db, config });
    await api.register(adminListRoutes, { db, config });
    await api.register(serverStatusRoutes, { db });
    await api.register(playerRoutes, { db });
    await api.register(pluginConfigRoutes, { db });
    await api.register(moderationRoutes, { db });
    await api.register(agentRoutes, { db });
    await api.register(accessAdminRoutes, { db });
    await api.register(liveActionRoutes, { db });
    await api.register(activityRoutes, { db });
    await api.register(clanRoutes, { db });
    await api.register(statsRoutes, { db });
    await api.register(adminCamRoutes, { db });
    await api.register(ruleRoutes, { db });
    await api.register(ticketRoutes, { db });
    await api.register(clanWarRoutes, { db });
  },
  { prefix: '/api' },
);

// WebSocket'ler kökte — vekil bunları doğrudan yönlendiriyor.
await app.register(agentWsRoutes, { db, config });
await app.register(browserWsRoutes, { db });

const port = Number(process.env.PORT ?? 3001);
app.listen({ port, host: '0.0.0.0' }).then(() => {
  logger.info(`api ${config.NODE_ENV} modunda :${port} portunda`);
  // Servis açılışı da günlüğe düşüyor: "o saatte panel neden cevap
  // vermiyordu" sorusunda yeniden başlatmalar ilk bakılan şey.
  kaydet({
    actorType: 'system',
    actorLabel: 'api',
    action: 'service.start',
    category: 'sistem',
    payload: { ortam: config.NODE_ENV, port },
  });
});

// Düzgün kapanış zorunlu: kalıcı yazım artık api'de ve raw_events 2 saniyelik
// batch'ler hâlinde gidiyor. app.close() çağrılmazsa onClose kancası (dolayısıyla
// writer.stop()) hiç çalışmaz ve her restart'ta son batch sessizce kaybolur.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'api kapanıyor, bekleyen yazımlar boşaltılıyor');
  kaydet({
    actorType: 'system',
    actorLabel: 'api',
    action: 'service.stop',
    category: 'sistem',
    payload: { signal },
  });
  try {
    await app.close();
  } catch (err) {
    logger.error({ err }, 'kapanışta hata');
  }
  // app.close()'tan SONRA: kapanış sırasında yazılan son kayıtlar da
  // (onClose kancaları dahil) tamponda kalmasın.
  await activityLogDurdur();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
