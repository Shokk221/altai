import { logger } from '@altai/shared';
import {
  type RealSquadServerLike,
  type SquadJSEngine,
  createDevFixtureEngine,
  createSquadJSAdapter,
  createSquadServerEngineAdapter,
} from '@altai/squad';
import { komutCalistir } from './commands.js';
import { loadAgentConfig } from './config.js';
import { createSpool } from './spool.js';
import { createUplink } from './uplink.js';

// Agent'ın Postgres'e erişimi YOK ve olmamalı. Kalıcı veri, agent'ın zaten
// açtığı WS üzerinden api'ye gider; api tek noktadan veritabanına yazar.
// Bunun iki sebebi var:
//   1. Postgres'in ağa açılması gerekmiyor — api ile aynı konteynerde,
//      yalnızca localhost'tan erişilebilir.
//   2. Oyun sunucusundaki bir sürecin veritabanı kimlik bilgisi taşıması
//      gereksiz bir risk.
// Bağlantı koptuğunda eventler diske spool edilir, gelince sırayla gönderilir.
const config = loadAgentConfig();

const spool = createSpool({ dir: config.AGENT_SPOOL_DIR });

// Motor uplink'ten SONRA kuruluyor (vendored SquadJS yüklemesi async), ama
// komut işleyicisinin ona erişmesi gerekiyor. Henüz hazır değilken komut
// gelirse sessizce yutmuyoruz — api'ye açık bir hata dönüyoruz.
let engine: SquadJSEngine | undefined;
const uplink = createUplink({
  url: config.AGENT_API_WS_URL,
  serverSlug: config.SERVER_SLUG,
  secret: config.AGENT_SHARED_SECRET,
  spool,
  onCommand: (msg) => {
    const { command } = msg;
    if (!engine) {
      uplink.sendCommandResult({
        correlationId: command.correlationId,
        ok: false,
        error: 'motor_hazir_degil',
      });
      return;
    }
    void komutCalistir(engine, command).then((sonuc) => {
      uplink.sendCommandResult({
        correlationId: command.correlationId,
        ok: sonuc.ok,
        ...(sonuc.error ? { error: sonuc.error } : {}),
        ...(sonuc.data !== undefined ? { data: sonuc.data } : {}),
      });
    });
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

engine = await resolveEngine();
const adapter = createSquadJSAdapter({
  serverSlug: config.SERVER_SLUG,
  engine,
  onEvent: (event) => uplink.send(event),
  onUnmatchedPlayer: (eosId, eventType) => {
    logger.debug({ eosId, eventType }, 'oyuncu RCON listesinde henüz yok, event atlandı');
  },
});

adapter.start();
logger.info(
  { serverSlug: config.SERVER_SLUG, engine: config.AGENT_ENGINE, spool: config.AGENT_SPOOL_DIR },
  'agent başladı',
);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'agent kapanıyor');
  adapter.stop();
  // uplink.shutdown: bekleyen eventleri gönderir, sonra api'ye kapanışı
  // bildirir ki açık session'lar gerçek zaman damgasıyla kapatılsın.
  await uplink.shutdown();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
