import type { AgentEvent } from '@altai/contracts';
import type {
  SquadJSChatMessageRaw,
  SquadJSEngine,
  SquadJSPlayerConnectedRaw,
  SquadJSPlayerDisconnectedRaw,
} from './engine.js';

const CHAT_CHANNEL_MAP: Record<SquadJSChatMessageRaw['chat'], 'All' | 'Team' | 'Squad' | 'Admin'> =
  {
    ChatAll: 'All',
    ChatTeam: 'Team',
    ChatSquad: 'Squad',
    ChatAdmin: 'Admin',
  };

export interface SquadJSAdapterOptions {
  // Sunucunun kısa adı (agent .env'indeki SERVER_SLUG). DB UUID'si DEĞİL —
  // agent veritabanına dokunmaz, slug -> UUID çözümlemesini api yapar.
  serverSlug: string;
  engine: SquadJSEngine;
  onEvent: (event: AgentEvent) => void;
  // player henüz RCON'un ListPlayers'ında görünmediği için eşleştirilemeyen
  // eventler için (gerçek fork'ta olur, bkz. plan notu) — opsiyonel, verilmezse sessizce atlanır.
  onUnmatchedPlayer?: (
    eosId: string,
    eventType: 'PLAYER_CONNECTED' | 'PLAYER_DISCONNECTED',
  ) => void;
  // Snapshot aralığı (ms) — plan varsayılanı 60 sn
  snapshotIntervalMs?: number;
}

export interface SquadJSAdapterHandle {
  start(): void;
  stop(): void;
}

export function createSquadJSAdapter(opts: SquadJSAdapterOptions): SquadJSAdapterHandle {
  const { serverSlug, engine, onEvent } = opts;
  const snapshotIntervalMs = opts.snapshotIntervalMs ?? 60_000;
  let snapshotTimer: ReturnType<typeof setInterval> | undefined;

  const handleConnected = (raw: SquadJSPlayerConnectedRaw) => {
    if (!raw.player) {
      opts.onUnmatchedPlayer?.(raw.eosID, 'PLAYER_CONNECTED');
      return;
    }
    onEvent({
      type: 'PLAYER_CONNECTED',
      serverSlug,
      steamId: raw.player.steamID,
      eosId: raw.player.eosID,
      name: raw.player.name,
      timestamp: raw.time.toISOString(),
    });
  };

  const handleDisconnected = (raw: SquadJSPlayerDisconnectedRaw) => {
    if (!raw.player) {
      opts.onUnmatchedPlayer?.(raw.eosID, 'PLAYER_DISCONNECTED');
      return;
    }
    onEvent({
      type: 'PLAYER_DISCONNECTED',
      serverSlug,
      steamId: raw.player.steamID,
      timestamp: raw.time.toISOString(),
    });
  };

  const handleChat = (raw: SquadJSChatMessageRaw) => {
    onEvent({
      type: 'CHAT_MESSAGE',
      serverSlug,
      steamId: raw.steamID,
      channel: CHAT_CHANNEL_MAP[raw.chat],
      message: raw.message,
      timestamp: raw.time.toISOString(),
    });
  };

  async function takeSnapshot() {
    try {
      const status = await engine.getStatus();
      onEvent({
        type: 'SERVER_SNAPSHOT',
        serverSlug,
        playerCount: status.playerCount,
        queueCount: status.publicQueue,
        layer: status.currentLayer,
        timestamp: new Date().toISOString(),
      });
    } catch {
      // RCON geçici olarak yanıt vermiyor olabilir — snapshot atlanır,
      // bir sonraki interval'de tekrar denenir (reconciler bu tür boşlukları
      // log eventlerinden onarır, bkz. plan Bölüm 5).
    }
  }

  return {
    start() {
      engine.on('PLAYER_CONNECTED', handleConnected);
      engine.on('PLAYER_DISCONNECTED', handleDisconnected);
      engine.on('CHAT_MESSAGE', handleChat);
      snapshotTimer = setInterval(takeSnapshot, snapshotIntervalMs);
      void takeSnapshot();
    },
    stop() {
      engine.off('PLAYER_CONNECTED', handleConnected);
      engine.off('PLAYER_DISCONNECTED', handleDisconnected);
      engine.off('CHAT_MESSAGE', handleChat);
      if (snapshotTimer) clearInterval(snapshotTimer);
    },
  };
}
