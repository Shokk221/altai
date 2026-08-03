// Bu paket SquadJS'i motor olarak SARAR, sıfırdan yazmaz (plan Bölüm 6).
// SquadJSEngine, gerçek vendored SquadJS SquadServer instance'ının (veya
// test/dev amaçlı bir fixture'ın) sağlaması gereken minimum yüzeydir.
// Gerçek entegrasyon (apps/agent) bu arayüze karşı yazılır; upstream SquadJS
// güncellemesi geldiğinde sadece bu arayüzü karşılayan bir wrapper gerekir,
// adapter/persistence/uplink hiçbiri değişmez.
//
// Alan adları (steamID, eosID, teamID, squadID, isLeader, role, currentLayer.name)
// gerçek vendored fork'un (squad-server/squad-server/index.js + rcon.js)
// incelenmesiyle doğrulandı — uydurulmadı. Bkz. real-engine-adapter.ts.

export interface SquadJSPlayer {
  steamID: string;
  eosID?: string | undefined;
  name: string;
  teamID?: number | null;
  squadID?: number | null;
  isLeader?: boolean;
  role?: string;
}

export interface SquadJSPlayerConnectedRaw {
  // Gerçek fork'ta PLAYER_CONNECTED eventi RCON'un ListPlayers'tan henüz
  // görmediği bir oyuncu için player'ı bulamayabilir (JOIN_SUCCEEDED log'u
  // RCON güncellemesinden önce gelebilir) — bu yüzden opsiyonel.
  player?: SquadJSPlayer | undefined;
  eosID: string;
  time: Date;
}

export interface SquadJSPlayerDisconnectedRaw {
  player?: SquadJSPlayer | undefined;
  eosID: string;
  time: Date;
}

export interface SquadJSChatMessageRaw {
  steamID: string;
  eosID?: string | undefined;
  chat: 'ChatAll' | 'ChatTeam' | 'ChatSquad' | 'ChatAdmin';
  message: string;
  time: Date;
}

export interface SquadJSServerStatusRaw {
  playerCount: number;
  publicQueue: number;
  currentLayer?: string | undefined;
}

// SquadJS'in ürettiği ham event isimleri — upstream'de bunlar sabit.
export interface SquadJSEngineEvents {
  PLAYER_CONNECTED: (raw: SquadJSPlayerConnectedRaw) => void;
  PLAYER_DISCONNECTED: (raw: SquadJSPlayerDisconnectedRaw) => void;
  CHAT_MESSAGE: (raw: SquadJSChatMessageRaw) => void;
}

export interface SquadJSEngine {
  serverSlug: string;
  on<K extends keyof SquadJSEngineEvents>(event: K, listener: SquadJSEngineEvents[K]): void;
  off<K extends keyof SquadJSEngineEvents>(event: K, listener: SquadJSEngineEvents[K]): void;
  // RCON ile anlık durum — snapshot için 60 sn'de bir çağrılır
  getStatus(): Promise<SquadJSServerStatusRaw>;
  // api'den gelen komutlar için (Faz 2/3'te dolacak)
  rconExecute(command: string): Promise<string>;
}
