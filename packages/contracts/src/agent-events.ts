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
]);

export type AgentEvent = z.infer<typeof AgentEvent>;
