import { z } from 'zod';
import { AgentCommand, AgentCommandResult } from './agent-commands.js';
import { AgentEvent } from './agent-events.js';

// Agent, api'ye dışa doğru kalıcı bir WS açar (Bölüm 3 — oyun sunucusunda
// içe açık port gerekmez). Bağlantı kurulduğunda ilk mesaj her zaman "hello"
// olmalı; api bunu AGENT_SHARED_SECRET ile doğrular.
export const AgentHello = z.object({
  type: z.literal('hello'),
  serverSlug: z.string(),
  secret: z.string(),
});
export type AgentHello = z.infer<typeof AgentHello>;

// Agent düzgün kapanırken (SIGTERM) gönderir. api bunu alınca o sunucunun
// açık session'larını gerçek zaman damgasıyla kapatır.
//
// WS'in kopması TEK BAŞINA session kapatma sebebi değildir — geçici bir ağ
// kesintisi de aynı görünür ve oyuncular hâlâ oyunda olabilir. Bu yüzden
// kapanış açıkça bildirilir; bildirim hiç gelmezse (crash, konteyner kill)
// açık session'ları bir sonraki hello'daki reconciler 4 saat üst sınırıyla
// toparlar.
export const AgentShutdown = z.object({
  type: z.literal('shutdown'),
  timestamp: z.string().datetime(),
});
export type AgentShutdown = z.infer<typeof AgentShutdown>;

// agent -> api yönünde giden zarf
export const AgentToApiMessage = z.union([
  AgentHello,
  AgentShutdown,
  z.object({ type: z.literal('event'), event: AgentEvent }),
  z.object({ type: z.literal('command_result'), result: AgentCommandResult }),
]);
export type AgentToApiMessage = z.infer<typeof AgentToApiMessage>;

// api -> agent yönünde giden zarf
export const ApiToAgentMessage = z.union([
  z.object({ type: z.literal('hello_ack'), serverId: z.string() }),
  z.object({ type: z.literal('hello_reject'), reason: z.string() }),
  z.object({ type: z.literal('command'), command: AgentCommand }),
]);
export type ApiToAgentMessage = z.infer<typeof ApiToAgentMessage>;
