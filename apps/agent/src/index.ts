import { createDb } from '@altai/db';
import { logger } from '@altai/shared';
import {
  type RealSquadServerLike,
  type SquadJSEngine,
  createDevFixtureEngine,
  createSquadJSAdapter,
  createSquadServerEngineAdapter,
} from '@altai/squad';
import { loadAgentConfig } from './config.js';
import {
  closeAllOpenSessions,
  createPersistenceWriter,
  reconcileStaleSessions,
} from './persistence-writer.js';
import { resolveServerId } from './server-registry.js';
import { createUplink } from './uplink.js';

const config = loadAgentConfig();
const db = createDb(config.DATABASE_URL);

const serverId = await resolveServerId(db, config.SERVER_SLUG, config.SERVER_NAME);
await reconcileStaleSessions(db, serverId);

const writer = createPersistenceWriter(db);
const uplink = createUplink({
  url: config.AGENT_API_WS_URL,
  serverSlug: config.SERVER_SLUG,
  secret: config.AGENT_SHARED_SECRET,
  onCommand: (msg) => {
    // Faz 2/3'te: kick/ban/warn/broadcast/setLayer/restart -> engine.rconExecute
    // yönlendirmesi burada olacak. Şimdilik sadece loglanır.
    logger.warn({ command: msg.command }, 'komut alındı ama henüz işlenmiyor (Faz 2)');
  },
});

async function resolveEngine(): Promise<SquadJSEngine> {
  if (config.AGENT_ENGINE === 'fixture') {
    logger.warn(
      'AGENT_ENGINE=fixture — gerçek SquadJS bağlı değil, sahte oyuncu eventleri üretiliyor. ' +
        'Gerçek entegrasyon için AGENT_ENGINE=real + SQUADJS_VENDOR_ENTRY (bkz. packages/squad/src/real-engine-adapter.ts).',
    );
    return createDevFixtureEngine(config.SERVER_SLUG);
  }

  // AGENT_ENGINE=real: SQUADJS_VENDOR_ENTRY'de belirtilen modül, gerçek
  // (ported) vendored SquadServer instance'ını sağlar. Modül ya instance'ı
  // doğrudan default export eder ya da onu üreten bir async factory verir —
  // bu, agent'ı gerçek vendored kodun tam yol/build detaylarından ayırır.
  const entry = config.SQUADJS_VENDOR_ENTRY as string;
  logger.info({ entry }, 'gerçek SquadJS vendor modülü yükleniyor');
  const mod = (await import(entry)) as {
    default: RealSquadServerLike | (() => Promise<RealSquadServerLike>);
  };
  const real = typeof mod.default === 'function' ? await mod.default() : mod.default;
  return createSquadServerEngineAdapter(real, config.SERVER_SLUG);
}

const engine = await resolveEngine();
const adapter = createSquadJSAdapter({
  serverId,
  engine,
  onEvent: (event) => {
    writer.write(event);
    uplink.send(event);
  },
  onUnmatchedPlayer: (eosId, eventType) => {
    logger.debug({ eosId, eventType }, 'oyuncu RCON listesinde henüz yok, event atlandı');
  },
});

adapter.start();
logger.info(
  { serverSlug: config.SERVER_SLUG, serverId, engine: config.AGENT_ENGINE },
  'agent başladı',
);

async function shutdown(signal: string) {
  logger.info({ signal }, "agent kapanıyor, açık session'lar kapatılıyor");
  adapter.stop();
  uplink.close();
  await writer.stop();
  await closeAllOpenSessions(db, serverId);
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
