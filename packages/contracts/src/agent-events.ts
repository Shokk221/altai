import { z } from 'zod';

// SquadJSAdapter'ın ürettiği, agent -> api WS üzerinden akan tipli eventler.
// SquadJS güncellemesi geldiğinde sadece adapter dosyası değişir, bu şema
// (ve ona bağlı her şey) etkilenmez.

export const PlayerConnectedEvent = z.object({
  type: z.literal('PLAYER_CONNECTED'),
  serverId: z.string(),
  steamId: z.string(),
  eosId: z.string().optional(),
  name: z.string(),
  timestamp: z.string().datetime(),
});

export const PlayerDisconnectedEvent = z.object({
  type: z.literal('PLAYER_DISCONNECTED'),
  serverId: z.string(),
  steamId: z.string(),
  timestamp: z.string().datetime(),
});

export const ChatMessageEvent = z.object({
  type: z.literal('CHAT_MESSAGE'),
  serverId: z.string(),
  steamId: z.string(),
  channel: z.enum(['All', 'Team', 'Squad', 'Admin']),
  message: z.string(),
  timestamp: z.string().datetime(),
});

export const AgentEvent = z.discriminatedUnion('type', [
  PlayerConnectedEvent,
  PlayerDisconnectedEvent,
  ChatMessageEvent,
]);

export type AgentEvent = z.infer<typeof AgentEvent>;
