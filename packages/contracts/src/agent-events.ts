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
  timestamp: z.string().datetime(),
});

export const AgentEvent = z.discriminatedUnion('type', [
  PlayerConnectedEvent,
  PlayerDisconnectedEvent,
  ChatMessageEvent,
  ServerSnapshotEvent,
]);

export type AgentEvent = z.infer<typeof AgentEvent>;
