import { z } from 'zod';

// api -> agent yönünde giden komutlar. correlationId + timeout ile eşleşir.
export const AgentCommand = z.object({
  correlationId: z.string().uuid(),
  serverId: z.string(),
  action: z.enum(['kick', 'ban', 'warn', 'broadcast', 'setLayer', 'restart']),
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
