import { z } from 'zod';

// api -> agent yönünde giden komutlar. correlationId + timeout ile eşleşir.
export const AgentCommand = z.object({
  correlationId: z.string().uuid(),
  serverId: z.string(),
  // 'ping' oyuna DOKUNMAZ: agent RCON'a hiç gitmeden cevaplar. Kanalın
  // (api -> WS -> agent -> cevap) çalıştığını, canlı sunucuda bir eylem
  // yapmadan doğrulamak için var. Bu olmadan kanalı sınamanın tek yolu
  // gerçek bir oyuncuyu atmaktı.
  // 'listPlayers' o an sunucuda olan oyuncuları döndürür. Ban uygulaması
  // buna dayanıyor: api periyodik olarak listeyi isteyip ban'lıları atıyor.
  action: z.enum([
    'ping',
    'kick',
    'ban',
    'warn',
    'broadcast',
    'listPlayers',
    'setLayer',
    'restart',
  ]),
  payload: z.record(z.unknown()),
  issuedBy: z.string(), // system role user id
});

export type AgentCommand = z.infer<typeof AgentCommand>;

export const AgentCommandResult = z.object({
  correlationId: z.string().uuid(),
  ok: z.boolean(),
  error: z.string().optional(),
  /** Komuta özel dönüş (örn. listPlayers'ın oyuncu listesi). */
  data: z.unknown().optional(),
});

/** listPlayers'ın döndürdüğü biçim. */
export const OnlinePlayer = z.object({
  steamId: z.string().nullable(),
  eosId: z.string().nullable(),
  name: z.string(),
  /** RCON ListPlayers'tan: takım 1/2, manga numarası, rol, manga lideri mi. */
  teamId: z.number().int().nullable(),
  squadId: z.number().int().nullable(),
  squadName: z.string().nullable(),
  role: z.string().nullable(),
  isLeader: z.boolean(),
});
export const OnlinePlayers = z.object({ players: z.array(OnlinePlayer) });
export type OnlinePlayer = z.infer<typeof OnlinePlayer>;
export type AgentCommandResult = z.infer<typeof AgentCommandResult>;
