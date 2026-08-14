import { z } from 'zod';

// SquadJSAdapter'ın ürettiği, agent -> api WS üzerinden akan tipli eventler.
// SquadJS güncellemesi geldiğinde sadece adapter dosyası değişir, bu şema
// (ve ona bağlı her şey) etkilenmez.
//
// Sunucu kimliği olarak veritabanı UUID'si değil `serverSlug` taşınır: agent
// artık Postgres'e hiç dokunmuyor (kalıcılık api'de), dolayısıyla DB id'lerini
// bilemez ve bilmemeli. Slug -> UUID çözümlemesini api, hello anında bir kez
// yapar.

export const PlayerConnectedEvent = z.object({
  type: z.literal('PLAYER_CONNECTED'),
  serverSlug: z.string(),
  steamId: z.string(),
  eosId: z.string().optional(),
  name: z.string(),
  timestamp: z.string().datetime(),
});

export const PlayerDisconnectedEvent = z.object({
  type: z.literal('PLAYER_DISCONNECTED'),
  serverSlug: z.string(),
  steamId: z.string(),
  timestamp: z.string().datetime(),
});

export const ChatMessageEvent = z.object({
  type: z.literal('CHAT_MESSAGE'),
  serverSlug: z.string(),
  steamId: z.string(),
  channel: z.enum(['All', 'Team', 'Squad', 'Admin']),
  message: z.string(),
  timestamp: z.string().datetime(),
});

// 60 sn'de bir agent tarafından üretilir (Bölüm 5: "Sunucu popülasyon geçmişi")
export const ServerSnapshotEvent = z.object({
  type: z.literal('SERVER_SNAPSHOT'),
  serverSlug: z.string(),
  playerCount: z.number().int().nonnegative(),
  queueCount: z.number().int().nonnegative().default(0),
  layer: z.string().optional(),
  /**
   * Sunucu tick hızı (TPS). Yalnızca oyun log'undan geliyor, RCON'da
   * karşılığı yok; log okunamıyorsa ya da değer bayatsa alan hiç
   * gönderilmiyor — 0 yazmak "sunucu donmuş" demek olurdu.
   */
  tickRate: z.number().positive().max(200).optional(),
  timestamp: z.string().datetime(),
});

/**
 * Yetkili işlemi — uyarma, atma, banlama, duyuru, admin kamerası.
 *
 * Kaynak RCON'un sohbet kanalı: Squad bu işlemleri metin olarak yayınlıyor.
 * Oyun İÇİNDEN yapılan işlemler panelden geçmediği için başka hiçbir
 * kaydımıza düşmüyordu — tek görünür oldukları yer burası.
 *
 * `steamId` OPSİYONEL ve bu bilinçli: Squad uyarı satırında yalnızca ismi
 * veriyor, kimlik yok. İsimle oyuncu uydurmak yerine kimliksiz bırakıp
 * satırı yine de gösteriyoruz.
 */
export const AdminActionEvent = z.object({
  type: z.literal('ADMIN_ACTION'),
  serverSlug: z.string(),
  action: z.enum(['warn', 'kick', 'ban', 'broadcast', 'cam_enter', 'cam_exit']),
  /** İşlemin hedefi (duyuruda yok). */
  playerName: z.string().optional(),
  steamId: z.string().optional(),
  eosId: z.string().optional(),
  /** Uyarı metni, kick/ban sebebi ya da duyurunun kendisi. */
  message: z.string().optional(),
  /** Yalnızca ban: Squad'ın kendi süre yazımı ("3d", "0" = kalıcı). */
  interval: z.string().optional(),
  timestamp: z.string().datetime(),
});

/**
 * Maç başlangıcı — SquadJS'in NEW_GAME olayı.
 *
 * Faz 1'in "PersistenceWriter (… /round/ …)" maddesi. Geçmiş maçlar eski
 * sistemin Mongo'sundan alındı; buradan sonrası canlı akıyor, ikisi de aynı
 * `rounds` tablosuna yazılıyor.
 */
export const RoundStartedEvent = z.object({
  type: z.literal('ROUND_STARTED'),
  serverSlug: z.string(),
  layer: z.string().optional(),
  map: z.string().optional(),
  timestamp: z.string().datetime(),
});

/**
 * Maç bitişi. Kazanan ve ticket bilgisi SquadJS'te ROUND_ENDED ile geliyor;
 * bazı harita/mod birleşimlerinde kazanan hiç bildirilmiyor, o yüzden tüm
 * alanlar opsiyonel — bilgi yoksa maçı kaydetmemek yerine eksik kaydediyoruz.
 */
export const RoundEndedEvent = z.object({
  type: z.literal('ROUND_ENDED'),
  serverSlug: z.string(),
  winnerTeam: z.number().int().min(1).max(2).optional(),
  winnerFaction: z.string().optional(),
  winnerTickets: z.number().int().optional(),
  loserFaction: z.string().optional(),
  loserTickets: z.number().int().optional(),
  timestamp: z.string().datetime(),
});

/**
 * Manga kuruldu. Canlı ekrandaki olay akışının parçası — BattleMetrics'te de
 * "X has created Squad 3" satırı olarak görünüyor ve moderasyonda kimin
 * hangi mangayı kurduğu takip ediliyor.
 */
export const SquadCreatedEvent = z.object({
  type: z.literal('SQUAD_CREATED'),
  serverSlug: z.string(),
  playerName: z.string(),
  steamId: z.string().nullish(),
  eosId: z.string().nullish(),
  squadId: z.string(),
  squadName: z.string(),
  teamName: z.string().nullish(),
  /**
   * Mangayı kuranın takımı.
   *
   * RCON satırında yalnızca takım ADI var; sayısal kimlik, çözümlenmiş
   * oyuncu kaydından (`data.player.teamID`) geliyor. Ada değil kimliğe
   * ihtiyaç var çünkü `AdminDisbandSquad <teamID> <squadID>` bunu istiyor —
   * bu alan olmadan manga dağıtan hiçbir plugin çalışamıyordu.
   */
  teamId: z.number().int().nullish(),
  timestamp: z.string().datetime(),
});

/**
 * Oyuncunun rol / manga / liderlik durumu değişti.
 *
 * Tek olay tipinde toplanıyorlar çünkü üçü de aynı kaynaktan (RCON oyuncu
 * listesi diff'i) ve aynı şekille geliyor; ayrı tipler yazmak üç kez aynı
 * alanları tekrarlamak olurdu. Hangi değişiklik olduğu `change` alanında.
 *
 * DİKKAT: bunlar log satırı değil, periyodik liste karşılaştırmasının
 * sonucu — gecikme oyuncu listesi tazeleme aralığı kadardır (~10 sn).
 */
export const PlayerStateChangeEvent = z.object({
  type: z.literal('PLAYER_STATE_CHANGE'),
  serverSlug: z.string(),
  change: z.enum(['role', 'squad', 'became_leader', 'lost_leader']),
  steamId: z.string().nullish(),
  eosId: z.string().nullish(),
  playerName: z.string(),
  teamId: z.number().int().nullish(),
  squadId: z.number().int().nullish(),
  isLeader: z.boolean(),
  role: z.string().nullish(),
  oldRole: z.string().nullish(),
  oldSquadId: z.number().int().nullish(),
  timestamp: z.string().datetime(),
});

/**
 * Takım arkadaşını öldürme.
 *
 * Motor bunu yalnızca gerçekten TK olduğunda yayınlıyor; olayın varlığı
 * TK'nın kendisidir, ayrıca bir bayrak kontrolü gerekmez.
 */
export const TeamkillEvent = z.object({
  type: z.literal('TEAMKILL'),
  serverSlug: z.string(),
  attackerName: z.string().nullish(),
  attackerSteamId: z.string().nullish(),
  attackerEosId: z.string().nullish(),
  victimName: z.string().nullish(),
  victimSteamId: z.string().nullish(),
  victimEosId: z.string().nullish(),
  weapon: z.string().nullish(),
  timestamp: z.string().datetime(),
});

/**
 * Kapanmış bir seed (sunucu doldurma) aralığı.
 *
 * Eski sistem bunu JOIN ve LEAVE olarak iki ayrı satır yazıyordu; toplam
 * süre okunurken ikisinin eşleştirilmesi gerekiyordu ve agent çöktüğünde
 * eşi olmayan JOIN satırları kalıyordu — "orphan reconciliation" diye ayrı
 * bir mekanizma sırf bunun için vardı.
 *
 * Burada olay KAPALI BİR ARALIK: başlangıcı, bitişi ve süresi kendi
 * içinde. Yarım kayıt diye bir şey olmadığı için eşleştirme de kurtarma da
 * gerekmiyor. Uzun oturumlar periyodik olarak parçalara bölünüp
 * gönderiliyor; toplam, parçaların toplamı.
 */
export const SeedSessionEvent = z.object({
  type: z.literal('SEED_SESSION'),
  serverSlug: z.string(),
  playerName: z.string(),
  steamId: z.string().nullish(),
  eosId: z.string().nullish(),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  durationSeconds: z.number().int().nonnegative(),
  /** Sunucu neden "seed" sayıldı. Admin nöbeti yalnızca 'gamemode' sayar. */
  seedReason: z.enum(['gamemode', 'player_count']),
  /** Oturum sırasında gerçek admin yetkisi var mıydı. */
  wasAdmin: z.boolean(),
  timestamp: z.string().datetime(),
});

export const AgentEvent = z.discriminatedUnion('type', [
  PlayerConnectedEvent,
  PlayerDisconnectedEvent,
  ChatMessageEvent,
  ServerSnapshotEvent,
  RoundStartedEvent,
  RoundEndedEvent,
  SquadCreatedEvent,
  AdminActionEvent,
  PlayerStateChangeEvent,
  TeamkillEvent,
  SeedSessionEvent,
]);

export type AgentEvent = z.infer<typeof AgentEvent>;
