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

/** SquadJS'in bellekteki oyuncu kaydından ihtiyacımız olan alanlar. */
export interface SquadJSOnlinePlayer {
  steamId: string | null;
  eosId: string | null;
  name: string;
  teamId: number | null;
  squadId: number | null;
  squadName: string | null;
  role: string | null;
  isLeader: boolean;
}

/** SquadJS'in SQUAD_CREATED olayi. */
export interface SquadJSSquadCreatedRaw {
  player?: { name?: string; steamID?: string; eosID?: string } | null | undefined;
  squadID?: string | number | undefined;
  squadName?: string | undefined;
  teamName?: string | undefined;
  time?: Date | string | undefined;
}

export interface SquadJSServerStatusRaw {
  playerCount: number;
  publicQueue: number;
  currentLayer?: string | undefined;
}

/**
 * Yeni maç. `layer` SquadJS'in Layer nesnesi: okunabilir ad `name`
 * ("Yehorivka RAAS v1"), harita adı `map.name`. Layer katalogdan
 * çözülemezse nesne gelmeyebilir; o yüzden `layerClassname` de taşınıyor.
 */
export interface SquadJSNewGameRaw {
  layer?: { name?: string; map?: { name?: string } } | null | undefined;
  layerClassname?: string | undefined;
  mapClassname?: string | undefined;
  time: Date;
}

/**
 * Maç bitişi. Beraberlikte ya da kazananın log'a düşmediği durumlarda
 * winner/loser null gelir — SquadJS'in kendi belgelediği davranış.
 * `team` ve `tickets` log'dan string olarak çıkıyor.
 */
export interface SquadJSRoundEndedRaw {
  winner?: { team?: string; faction?: string; subfaction?: string; tickets?: string } | null;
  loser?: { team?: string; faction?: string; subfaction?: string; tickets?: string } | null;
  time: Date;
}

/**
 * Sunucu tick hızı. Squad log'a düzenli aralıklarla
 * "USQGameState: Server Tick Rate: 39.42" satırı yazıyor; SquadJS bunu
 * ayrıştırıp TICK_RATE olarak yayınlıyor. RCON'da karşılığı YOK, tek
 * kaynak bu satır.
 */
export interface SquadJSTickRateRaw {
  tickRate: number;
  time?: Date | string | undefined;
}

/**
 * Yetkili işlemleri.
 *
 * Bunlar RCON'un sohbet kanalından geliyor: Squad bir admin komutu
 * çalıştırıldığında "Remote admin has warned player X. Message was ..."
 * gibi satırlar yayınlıyor ve SquadJS bunları ayrıştırıp olaya çeviriyor.
 *
 * Değeri şurada: oyun İÇİNDEN yapılan işlemler (admin tuşuyla atma, uyarma)
 * panelden geçmiyor, yani başka hiçbir kaydımıza düşmüyordu. Tek görünür
 * oldukları yer bu kanal.
 *
 * Ham veri kimlik konusunda cimri: uyarıda YALNIZCA isim var, SteamID yok.
 * Bu yüzden kimlik alanları opsiyonel ve isim her zaman taşınıyor.
 */
export interface SquadJSAdminActionRaw {
  name?: string | undefined;
  /** Uyarı metni ya da kick/ban sebebi. */
  reason?: string | undefined;
  /** Yalnızca ban: "3d", "permanent" gibi Squad'ın kendi yazımı. */
  interval?: string | undefined;
  message?: string | undefined;
  steamID?: string | undefined;
  eosID?: string | undefined;
  from?: string | undefined;
  time?: Date | string | undefined;
}

// SquadJS'in ürettiği ham event isimleri — upstream'de bunlar sabit.
export interface SquadJSEngineEvents {
  PLAYER_CONNECTED: (raw: SquadJSPlayerConnectedRaw) => void;
  PLAYER_DISCONNECTED: (raw: SquadJSPlayerDisconnectedRaw) => void;
  CHAT_MESSAGE: (raw: SquadJSChatMessageRaw) => void;
  NEW_GAME: (raw: SquadJSNewGameRaw) => void;
  ROUND_ENDED: (raw: SquadJSRoundEndedRaw) => void;
  SQUAD_CREATED: (raw: SquadJSSquadCreatedRaw) => void;
  TICK_RATE: (raw: SquadJSTickRateRaw) => void;
  PLAYER_WARNED: (raw: SquadJSAdminActionRaw) => void;
  PLAYER_KICKED: (raw: SquadJSAdminActionRaw) => void;
  PLAYER_BANNED: (raw: SquadJSAdminActionRaw) => void;
  ADMIN_BROADCAST: (raw: SquadJSAdminActionRaw) => void;
  POSSESSED_ADMIN_CAMERA: (raw: SquadJSAdminActionRaw) => void;
  UNPOSSESSED_ADMIN_CAMERA: (raw: SquadJSAdminActionRaw) => void;
}

export interface SquadJSEngine {
  serverSlug: string;
  on<K extends keyof SquadJSEngineEvents>(event: K, listener: SquadJSEngineEvents[K]): void;
  off<K extends keyof SquadJSEngineEvents>(event: K, listener: SquadJSEngineEvents[K]): void;
  // RCON ile anlık durum — snapshot için 60 sn'de bir çağrılır
  getStatus(): Promise<SquadJSServerStatusRaw>;
  /**
   * O an sunucuda olan oyuncular. Ban uygulaması buna dayanıyor: api
   * periyodik olarak listeyi isteyip aktif ban'ı olanları attırıyor.
   */
  getPlayers(): Promise<SquadJSOnlinePlayer[]>;
  /**
   * Bellekteki listeyi RCON'dan tazeler.
   *
   * `getPlayers()` SquadJS'in ÖNBELLEĞİNİ okuyor ve o önbellek 10 saniyede
   * bir yenileniyor. Takım değiştirme gibi bir komutun hemen ardından
   * listeyi okumak, komuttan ÖNCEKİ durumu geri getiriyordu — ekranda
   * oyuncu karşıya geçip sonra eski takımına dönüyor gibi görünüyordu.
   * Gerçek kurulumda böyle görüldü.
   */
  refreshPlayers(): Promise<void>;
  // api'den gelen komutlar için (Faz 2/3'te dolacak)
  rconExecute(command: string): Promise<string>;
}
