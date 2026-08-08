import { z } from 'zod';

// Uygulama config'i burada tipli olarak doğrulanır.
// Eksik/yanlış .env varsa, uygulama sessizce yanlış çalışmak yerine
// açılışta anlaşılır bir hatayla durur.
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(16),
  DISCORD_CLIENT_ID: z.string(),
  DISCORD_CLIENT_SECRET: z.string(),
  DISCORD_BOT_TOKEN: z.string(),
  DISCORD_GUILD_ID: z.string(),
  DISCORD_CALLBACK_URL: z.string().url().optional(),
  WEB_APP_URL: z.string().url().optional(),
  // Discord kesintisinde panele girmek için Discord'dan bağımsız acil hesap.
  // İkisi de boşsa /auth/break-glass endpoint'i devre dışı kalır.
  BREAK_GLASS_USER: z.string().optional(),
  BREAK_GLASS_PASSWORD_HASH: z.string().optional(),
  // agent -> api WS bağlantısını doğrulamak için (agent'ın kendi .env'inde de aynı değer olmalı)
  AGENT_SHARED_SECRET: z.string().optional(),
  // Squad sunucularının remote ban list'i çekerken kullandığı token.
  // URL'de taşınır (Squad düz GET atıyor, header ekleyemiyoruz), o yüzden
  // tahmin edilemez olmalı: openssl rand -hex 24
  BAN_LIST_TOKEN: z.string().min(16).optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Geçersiz konfigürasyon:', parsed.error.flatten().fieldErrors);
    process.exit(1);
  }
  return parsed.data;
}
