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
  // Squad sunucularının remote ADMIN list'i çekerken kullandığı token.
  // Ban listesinden AYRI olmalı: biri sızarsa diğeri etkilenmesin.
  ADMIN_LIST_TOKEN: z.string().min(16).optional(),
  // Fastify'ın req.ip'yi X-Forwarded-For'dan okuyup okumayacağı.
  //
  // Üretimde api 127.0.0.1'e bağlı ve önünde Caddy var; bu ayar olmadan
  // req.ip HER istekte vekilin adresi oluyor ve hız sınırının tamamı tek
  // ortak kovaya düşüyor — break-glass'ın 5/dk sınırı saldırgana değil
  // herkese ortak olur, tek saldırgan bütün adminleri kilitler.
  //
  // Varsayılan olarak KAPALI: başlığa körü körüne güvenmek, vekil arkasında
  // olmayan bir kurulumda istemcinin kendi IP'sini uydurmasına izin verir.
  // Vekil arkasında çalıştırırken 'loopback' (Caddy aynı makinede) ya da
  // vekilin IP'si verilmeli.
  TRUST_PROXY: z.string().optional(),

  /**
   * Ban uygulamasının çalışma kipi (bkz. apps/api/src/lib/ban-enforcer.ts).
   *
   *   on    — TÜM aktif banlar uygulanır
   *   altai — yalnızca BU PANELDEN atılan banlar uygulanır
   *   dry   — hiçbiri atılmaz, yalnızca "atılacaktı" diye loglanır
   *   off   — hiç kontrol edilmez
   *
   * `altai` geçiş dönemi için: veritabanındaki banların çok büyük kısmı
   * BattleMetrics'ten aktarılmış dondurulmuş bir kopya ve oyun sunucusu
   * hâlâ ESKİ sistemin ban listesini çekiyor. Bu kipte eski banları eski
   * sistem uygulamaya devam eder, panelden atılan yeni banlar ise anında
   * geçerli olur — iki sistem çakışmadan yan yana çalışır.
   *
   * `dry` ise şüphe hâlinde: neyin atılacağını atmadan gösterir.
   */
  BAN_ENFORCEMENT: z.enum(['on', 'altai', 'dry', 'off']).default('on'),
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
