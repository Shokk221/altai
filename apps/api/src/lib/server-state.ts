export interface LivePlayer {
  steamId: string;
  name: string;
  joinedAt: string;
}

export interface LiveServerState {
  serverSlug: string;
  playerCount: number;
  queueCount: number;
  layer?: string;
  players: LivePlayer[];
  updatedAt: string;
}

const state = new Map<string, LiveServerState>();
type Listener = (slug: string, state: LiveServerState) => void;
const listeners = new Set<Listener>();

function getOrInit(slug: string): LiveServerState {
  const existing = state.get(slug);
  if (existing) return existing;
  const fresh: LiveServerState = {
    serverSlug: slug,
    playerCount: 0,
    queueCount: 0,
    players: [],
    updatedAt: new Date().toISOString(),
  };
  state.set(slug, fresh);
  return fresh;
}

export function getServerState(slug: string): LiveServerState | undefined {
  return state.get(slug);
}

/**
 * Canlı listedeki oyuncunun adı. Sohbet olayı isim taşımıyor (sözleşmede
 * yalnızca steamId var) ama canlı ekranda kimin konuştuğu görünmeli.
 * Oyuncu listede yoksa null — uydurma isim üretmiyoruz.
 */
export function oyuncuAdi(slug: string, steamId: string): string | null {
  return state.get(slug)?.players.find((p) => p.steamId === steamId)?.name ?? null;
}

export function listServerStates(): LiveServerState[] {
  return [...state.values()];
}

export function onServerStateChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(slug: string) {
  const current = getOrInit(slug);
  current.updatedAt = new Date().toISOString();
  for (const listener of listeners) listener(slug, current);
}

export function applyPlayerConnected(
  slug: string,
  steamId: string,
  name: string,
  timestamp: string,
) {
  const s = getOrInit(slug);
  if (!s.players.some((p) => p.steamId === steamId)) {
    s.players.push({ steamId, name, joinedAt: timestamp });
    s.playerCount = s.players.length;
  }
  publish(slug);
}

export function applyPlayerDisconnected(slug: string, steamId: string) {
  const s = getOrInit(slug);
  s.players = s.players.filter((p) => p.steamId !== steamId);
  s.playerCount = s.players.length;
  publish(slug);
}

export function applyServerSnapshot(
  slug: string,
  playerCount: number,
  queueCount: number,
  layer: string | undefined,
) {
  const s = getOrInit(slug);
  s.queueCount = queueCount;
  if (layer !== undefined) s.layer = layer;
  // playerCount kaynağı asıl connect/disconnect eventleri; snapshot sadece
  // queue/layer günceller ve RCON'un gördüğü sayı çok sapmışsa (kaçırılmış
  // event) düzeltir.
  if (Math.abs(s.players.length - playerCount) > 0) s.playerCount = playerCount;
  publish(slug);
}
