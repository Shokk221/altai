import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  AGENT_API_WS_URL: z.string().url(),
  AGENT_SHARED_SECRET: z.string().min(8),
  SERVER_SLUG: z.string(),
  SERVER_NAME: z.string().default('Altai Squad Server'),
  // 'fixture': gerçek sunucu olmadan test için sahte motor.
  // 'real': gerçek (ported) vendored SquadServer instance'ını kullanır —
  // bunun için SQUADJS_VENDOR_ENTRY gerekir (bkz. real-engine-adapter.ts).
  AGENT_ENGINE: z.enum(['fixture', 'real']).default('fixture'),
  // AGENT_ENGINE=real olduğunda: default export olarak ya doğrudan bir
  // RealSquadServerLike instance'ı ya da onu üreten bir async factory
  // fonksiyonu (`() => Promise<RealSquadServerLike>`) veren modülün yolu.
  SQUADJS_VENDOR_ENTRY: z.string().optional(),
  RCON_HOST: z.string().optional(),
  RCON_PORT: z.coerce.number().optional(),
  RCON_PASSWORD: z.string().optional(),
});

export type AgentConfig = z.infer<typeof envSchema>;

export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Agent konfigürasyonu geçersiz:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  if (parsed.data.AGENT_ENGINE === 'real' && !parsed.data.SQUADJS_VENDOR_ENTRY) {
    // eslint-disable-next-line no-console
    console.error('AGENT_ENGINE=real için SQUADJS_VENDOR_ENTRY zorunlu');
    process.exit(1);
  }
  return parsed.data;
}
