export interface LivePlayer {
  steamId: string;
  eosId: string | null;
  name: string;
  joinedAt: string;
  /** RCON tazelemesinden gelir; olaydan gelen satırlarda null olabilir. */
  teamId: number | null;
  squadId: number | null;
  squadName: string | null;
  role: string | null;
  isLeader: boolean;
}

export interface LiveServerState {
  serverSlug: string;
  playerCount: number;
  queueCount: number;
  layer?: string;
  /**
   * Sunucu tick hızı (TPS). Tanımsız = bilinmiyor (agent log okuyamıyor ya
   * da değer bayat). 0 ile karıştırılmamalı: 0 "sunucu donmuş" demek.
   */
  // `| undefined` açıkça yazılıyor: exactOptionalPropertyTypes altında
  // `?: number` alana undefined ATAMAYA izin vermiyor, oysa TPS bilinmez
  // hâle geldiğinde değeri temizlemek zorundayız.
  tickRate?: number | undefined;
  /** tickRate'in okunduğu an; ekranda "ne kadar eski" sorusunu cevaplıyor. */
  tickRateAt?: string | undefined;
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
    // Takım/manga/rol henüz bilinmiyor: oyuncu daha yeni girdi, mangaya
    // katılmadı. Bir sonraki RCON tazelemesi dolduruyor.
    s.players.push({
      steamId,
      eosId: null,
      name,
      joinedAt: timestamp,
      teamId: null,
      squadId: null,
      squadName: null,
      role: null,
      isLeader: false,
    });
    s.playerCount = s.players.length;
  }
  publish(slug);
}

/**
 * RCON'dan gelen tam listeyle değiştirir.
 *
 * Olaylardan türeyen liste zamanla gerçekten AYRIŞIYOR: kaçırılan bir
 * disconnect oyuncuyu sonsuza kadar listede bırakıyor, takım/manga bilgisi
 * ise olaylarda hiç gelmiyor. RCON tek doğru kaynak.
 *
 * `joinedAt` korunuyor: RCON oyuncunun ne zaman girdiğini bilmiyor, o bilgi
 * yalnızca bizde var ve canlı ekranda "ne kadardır burada" olarak okunuyor.
 */
export function replacePlayers(
  slug: string,
  gelenler: Omit<LivePlayer, 'joinedAt'>[],
  simdi: string,
) {
  const s = getOrInit(slug);
  const oncekiGiris = new Map(s.players.map((p) => [p.steamId, p.joinedAt]));
  s.players = gelenler.map((p) => ({
    ...p,
    joinedAt: oncekiGiris.get(p.steamId) ?? simdi,
  }));
  s.playerCount = s.players.length;
  publish(slug);
}

/**
 * Takım değişimini canlı listeye ANINDA yansıtır.
 *
 * RCON tazelemesi 20 saniyede bir çalışıyor; ona bırakınca yetkili
 * oyuncuyu karşıya attıktan sonra ekranda 20 saniye boyunca eski takımda
 * görüyor ve komut çalışmadı sanıyor. Gerçek kurulumda böyle görüldü.
 *
 * Tahmin yürütmüyoruz: AdminForceTeamChange'in ne yaptığı belli —
 * oyuncu hedef takıma geçer ve mangasız kalır (mangada kalamaz, manga
 * öteki takımda). Yine de hemen ardından bir tazeleme isteniyor, yani bu
 * yalnızca aradaki boşluğu dolduruyor; doğrunun kaynağı hâlâ RCON.
 */
export function applyTeamChange(slug: string, steamIds: string[], hedefTakim: 1 | 2) {
  const s = state.get(slug);
  if (!s) return;
  const hedefler = new Set(steamIds);
  let degisti = false;

  s.players = s.players.map((p) => {
    if (!hedefler.has(p.steamId)) return p;
    if (p.teamId === hedefTakim) return p;
    degisti = true;
    return {
      ...p,
      teamId: hedefTakim,
      squadId: null,
      squadName: null,
      isLeader: false,
    };
  });

  if (degisti) publish(slug);
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
  tickRate?: number | undefined,
) {
  const s = getOrInit(slug);
  s.queueCount = queueCount;
  if (layer !== undefined) s.layer = layer;
  // Gelmediğinde ESKİ DEĞER SİLİNİYOR: agent log'u okuyamaz hâle geldiyse
  // ekranda donmuş bir TPS'in doğruymuş gibi durması, hiç göstermemekten
  // daha kötü.
  if (tickRate !== undefined) {
    s.tickRate = tickRate;
    s.tickRateAt = new Date().toISOString();
  } else {
    s.tickRate = undefined;
    s.tickRateAt = undefined;
  }
  // Oyuncu sayısının asıl kaynağı artık RCON tazelemesi (replacePlayers);
  // snapshot yalnızca iki tazeleme arasında sayıyı güncel tutuyor.
  if (Math.abs(s.players.length - playerCount) > 0) s.playerCount = playerCount;
  publish(slug);
}
