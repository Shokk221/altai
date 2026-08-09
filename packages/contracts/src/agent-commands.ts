import { z } from 'zod';

// api -> agent yönünde giden komutlar. correlationId + timeout ile eşleşir.
export const AgentCommand = z.object({
  correlationId: z.string().uuid(),
  serverId: z.string(),
  // 'ping' oyuna DOKUNMAZ: agent RCON'a hiç gitmeden cevaplar. Kanalın
  // (api -> WS -> agent -> cevap) çalıştığını, canlı sunucuda bir eylem
  // yapmadan doğrulamak için var. Bu olmadan kanalı sınamanın tek yolu
  // gerçek bir oyuncuyu atmaktı.
  action: z.enum(['ping', 'kick', 'ban', 'warn', 'broadcast', 'setLayer', 'restart']),
  payload: z.record(z.unknown()),
  issuedBy: z.string(), // system role user id
});

export type AgentCommand = z.infer<typeof AgentCommand>;

export const AgentCommandResult = z.object({
  correlationId: z.string().uuid(),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type AgentCommandResult = z.infer<typeof AgentCommandResult>;
