import { randomUUID } from 'node:crypto';
import type {
  SquadJSChatMessageRaw,
  SquadJSEngine,
  SquadJSEngineEvents,
  SquadJSPlayerConnectedRaw,
  SquadJSPlayerDisconnectedRaw,
  SquadJSServerStatusRaw,
} from './engine.js';

const FAKE_NAMES = ['Kartal61', 'Yaren.', 'DemirSL', 'Baris_TR', 'Nehir', 'Selim07'];

// Gerçek bir Squad sunucusu olmadan agent -> adapter -> persistence -> uplink
// zincirini uçtan uca test etmek için. AGENT_USE_FIXTURE=true ile devreye girer.
// SquadJSAdapter fixture testlerinin (plan Bölüm 8, test stratejisi #1) canlı
// sürümü gibi düşünülebilir.
export function createDevFixtureEngine(serverSlug: string): SquadJSEngine {
  const listeners = new Map<keyof SquadJSEngineEvents, Set<(...args: never[]) => void>>();
  const connectedPlayers = new Map<string, { eosId: string; name: string }>(); // steamId -> ...

  function emit<K extends keyof SquadJSEngineEvents>(
    event: K,
    ...args: Parameters<SquadJSEngineEvents[K]>
  ) {
    const set = listeners.get(event);
    if (!set) return;
    for (const listener of set) (listener as (...a: unknown[]) => void)(...args);
  }

  setInterval(() => {
    if (connectedPlayers.size >= FAKE_NAMES.length) return;
    const steamId = `765611980${Math.floor(Math.random() * 900000 + 100000)}`;
    const eosId = randomUUID();
    const name = FAKE_NAMES[connectedPlayers.size] ?? `Oyuncu${connectedPlayers.size}`;
    connectedPlayers.set(steamId, { eosId, name });
    const raw: SquadJSPlayerConnectedRaw = {
      player: { steamID: steamId, eosID: eosId, name },
      eosID: eosId,
      time: new Date(),
    };
    emit('PLAYER_CONNECTED', raw);
  }, 8_000);

  setInterval(() => {
    if (connectedPlayers.size === 0) return;
    const steamId = [...connectedPlayers.keys()][Math.floor(Math.random() * connectedPlayers.size)];
    if (!steamId) return;
    const info = connectedPlayers.get(steamId);
    if (!info) return;
    connectedPlayers.delete(steamId);
    const raw: SquadJSPlayerDisconnectedRaw = {
      player: { steamID: steamId, eosID: info.eosId, name: info.name },
      eosID: info.eosId,
      time: new Date(),
    };
    emit('PLAYER_DISCONNECTED', raw);
  }, 25_000);

  setInterval(() => {
    if (connectedPlayers.size === 0) return;
    const steamId = [...connectedPlayers.keys()][Math.floor(Math.random() * connectedPlayers.size)];
    if (!steamId) return;
    const info = connectedPlayers.get(steamId);
    if (!info) return;
    const raw: SquadJSChatMessageRaw = {
      steamID: steamId,
      eosID: info.eosId,
      chat: 'ChatAll',
      message: `merhaba (fixture mesajı ${randomUUID().slice(0, 4)})`,
      time: new Date(),
    };
    emit('CHAT_MESSAGE', raw);
  }, 15_000);

  return {
    serverSlug,
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(listener as never);
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener as never);
    },
    async getStatus(): Promise<SquadJSServerStatusRaw> {
      return {
        playerCount: connectedPlayers.size,
        publicQueue: 0,
        currentLayer: 'Narva_RAAS_v1',
      };
    },
    async getPlayers() {
      return [];
    },

    async rconExecute(command: string): Promise<string> {
      return `[fixture] komut alındı ama gerçek RCON yok: ${command}`;
    },
  } satisfies SquadJSEngine;
}
