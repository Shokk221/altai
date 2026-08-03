import SquadServer from 'squad-server';

// apps/agent/src/index.ts bu modülü SQUADJS_VENDOR_ENTRY ile dinamik import
// eder ve default export'un döndürdüğü instance'ı
// createSquadServerEngineAdapter()'a verir (bkz. packages/squad/src/real-engine-adapter.ts).
//
// Gerekli env değişkenleri (agent'ın kendi .env'i, oyun sunucusunda):
//   RCON_HOST, RCON_PORT, RCON_PASSWORD  — zaten .env.example'da var
//   SQUAD_LOG_DIR                        — SquadGame.log'un bulunduğu klasör
//                                           (örn. .../SquadGame/Saved/Logs)
//   SQUAD_QUERY_PORT (opsiyonel)         — sadece log mesajında görünür, işlevsel değil
export default async function createRealSquadServer() {
  const host = requireEnv('RCON_HOST');
  const rconPort = Number(requireEnv('RCON_PORT'));
  const rconPassword = requireEnv('RCON_PASSWORD');
  const logDir = requireEnv('SQUAD_LOG_DIR');

  const server = new SquadServer({
    host,
    queryPort: process.env.SQUAD_QUERY_PORT ? Number(process.env.SQUAD_QUERY_PORT) : undefined,
    rconHost: host,
    rconPort,
    rconPassword,
    rconAutoReconnectInterval: 5000,
    logReaderMode: 'tail',
    logDir,
  });

  // watch(): RCON'a bağlanır, log dosyasını tail'lemeye başlar, layer
  // kataloğunu çekmeyi dener (başarısız olursa sessizce cache'e/olmadan devam eder).
  await server.watch();

  return server;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} tanımlı değil (gerçek SquadJS motoru için zorunlu)`);
  return value;
}
