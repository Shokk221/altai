import type {
  SquadJSChatMessageRaw,
  SquadJSEngine,
  SquadJSEngineEvents,
  SquadJSNewGameRaw,
  SquadJSPlayerConnectedRaw,
  SquadJSPlayerDisconnectedRaw,
  SquadJSRoundEndedRaw,
  SquadJSServerStatusRaw,
} from './engine.js';

// Gerçek vendored SquadServer instance'ının (squad-server/squad-server/index.js)
// bu entegrasyon için kullandığımız minimum yüzeyi. Tam sınıf çok daha fazlasını
// yapar (squads, admin cam, A2S, layer history...) ama agent'ın ihtiyacı bu kadarı.
//
// EventEmitter olduğu için .on/.off zaten uyumlu — sadece event payload'larının
// alan adlarını (steamID, eosID, currentLayer.name, publicQueue, playerCount)
// doğru okumamız gerekiyor.
export interface RealSquadServerLike {
  on(event: string, listener: (...args: never[]) => void): void;
  off(event: string, listener: (...args: never[]) => void): void;
  readonly playerCount: number;
  readonly publicQueue: number;
  readonly currentLayer?: { name?: string } | null;
  rcon: {
    execute(command: string): Promise<string>;
  };
}

// Gerçek fork'un RCON/log-parser'dan ürettiği ham event şekilleri (doğrulandı,
// bkz. squad-server/squad-server/index.js satır ~330-365 ve rcon.js).
interface RealJoinSucceededData {
  player?: { steamID: string; eosID?: string; name: string };
  eosID: string;
  time: Date | string;
}

interface RealPlayerDisconnectedData {
  player?: { steamID: string; eosID?: string; name: string };
  eosID: string;
  time: Date | string;
}

interface RealChatMessageData {
  steamID: string;
  eosID?: string;
  chat: 'ChatAll' | 'ChatTeam' | 'ChatSquad' | 'ChatAdmin';
  message: string;
  time: Date | string;
}

// new-game.js: layer katalogdan çözülür, layerClassname ham log'dan gelir.
interface RealNewGameData {
  layer?: { name?: string; map?: { name?: string } } | null;
  layerClassname?: string;
  mapClassname?: string;
  time: Date | string;
}

// round-ended.js: beraberlikte winner ve loser null. Ticket ve takım
// numarası log'dan string olarak çıkıyor (round-tickets.js).
interface RealRoundEndedData {
  winner?: { team?: string; faction?: string; subfaction?: string; tickets?: string } | null;
  loser?: { team?: string; faction?: string; subfaction?: string; tickets?: string } | null;
  time: Date | string;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

type RealListener = (...args: never[]) => void;

// Faz 1'in gerçek entegrasyon noktası: vendored SquadJS fork'unuz
// packages/squad/vendor/{core,squad-server}'a taşındı ve bu arayüze karşı
// çalışacak şekilde zaten porting edildi:
// - 'core/...' bare import'ları gerçek pnpm workspace paketleri olarak çözülüyor
//   (packages/squad/vendor/core, package.json'daki "exports" map'iyle)
// - loadAdminsFromDB (Mongo) kaldırıldı, boş liste dönen bir stub'la değiştirildi
//   (Admins.cfg üretimi Faz 2'de RBAC'tan yapılacak)
// - pingSquadJSAPI() telemetrisi tamamen silindi (plan: dışa bağımlılık azaltma)
// - admin-cam süre kurtarma'nın DB katmanı (admin_cam_logs Postgres'te henüz
//   yok, Faz 6) no-op'a çevrildi; in-memory katman ve "kayıp session" fallback'i duruyor
// - ftp/sftp log reader'ları tamamen kaldırıldı (v2 her zaman lokal tail kullanır)
//
// packages/squad/vendor/agent-entry/index.js tam da bu fonksiyonun beklediği
// SQUADJS_VENDOR_ENTRY sözleşmesini uyguluyor (RCON_*/SQUAD_LOG_DIR env'inden
// gerçek bir SquadServer kurar + watch() eder). Hâlâ test edilmemiş olan tek
// şey gerçek bir Squad sunucusuna karşı çalıştırmak — bu ortamda o sunucu yok.
export function createSquadServerEngineAdapter(
  real: RealSquadServerLike,
  serverSlug: string,
): SquadJSEngine {
  // adapter.stop() çağrıldığında engine.off(event, listener) ile ORİJİNAL
  // listener referansı geri gelir; real.on()'a verdiğimiz wrapper'ı bulup
  // real.off()'a onu vermemiz gerekir — bu registry o eşleşmeyi tutar.
  const wrapperRegistry = new Map<SquadJSEngineEvents[keyof SquadJSEngineEvents], RealListener>();

  function register<K extends keyof SquadJSEngineEvents>(
    event: K,
    listener: SquadJSEngineEvents[K],
    wrapper: RealListener,
  ) {
    wrapperRegistry.set(listener, wrapper);
    real.on(event, wrapper);
  }

  return {
    serverSlug,

    on<K extends keyof SquadJSEngineEvents>(event: K, listener: SquadJSEngineEvents[K]) {
      if (event === 'PLAYER_CONNECTED') {
        register(event, listener, ((data: RealJoinSucceededData) => {
          const raw: SquadJSPlayerConnectedRaw = {
            player: data.player,
            eosID: data.eosID,
            time: toDate(data.time),
          };
          (listener as SquadJSEngineEvents['PLAYER_CONNECTED'])(raw);
        }) as RealListener);
      } else if (event === 'PLAYER_DISCONNECTED') {
        register(event, listener, ((data: RealPlayerDisconnectedData) => {
          const raw: SquadJSPlayerDisconnectedRaw = {
            player: data.player,
            eosID: data.eosID,
            time: toDate(data.time),
          };
          (listener as SquadJSEngineEvents['PLAYER_DISCONNECTED'])(raw);
        }) as RealListener);
      } else if (event === 'CHAT_MESSAGE') {
        register(event, listener, ((data: RealChatMessageData) => {
          const raw: SquadJSChatMessageRaw = {
            steamID: data.steamID,
            eosID: data.eosID,
            chat: data.chat,
            message: data.message,
            time: toDate(data.time),
          };
          (listener as SquadJSEngineEvents['CHAT_MESSAGE'])(raw);
        }) as RealListener);
      } else if (event === 'NEW_GAME') {
        register(event, listener, ((data: RealNewGameData) => {
          const raw: SquadJSNewGameRaw = {
            layer: data.layer ?? null,
            layerClassname: data.layerClassname,
            mapClassname: data.mapClassname,
            time: toDate(data.time),
          };
          (listener as SquadJSEngineEvents['NEW_GAME'])(raw);
        }) as RealListener);
      } else if (event === 'ROUND_ENDED') {
        register(event, listener, ((data: RealRoundEndedData) => {
          const raw: SquadJSRoundEndedRaw = {
            winner: data.winner ?? null,
            loser: data.loser ?? null,
            time: toDate(data.time),
          };
          (listener as SquadJSEngineEvents['ROUND_ENDED'])(raw);
        }) as RealListener);
      }
    },

    off<K extends keyof SquadJSEngineEvents>(event: K, listener: SquadJSEngineEvents[K]) {
      const wrapper = wrapperRegistry.get(listener);
      if (!wrapper) return;
      real.off(event, wrapper);
      wrapperRegistry.delete(listener);
    },

    async getStatus(): Promise<SquadJSServerStatusRaw> {
      return {
        playerCount: real.playerCount ?? 0,
        publicQueue: real.publicQueue ?? 0,
        currentLayer: real.currentLayer?.name,
      };
    },

    async rconExecute(command: string): Promise<string> {
      return real.rcon.execute(command);
    },
  };
}
