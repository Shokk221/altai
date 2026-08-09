import type { AppConfig } from '@altai/shared';
import fastifyOauth2 from '@fastify/oauth2';
import type { FastifyInstance } from 'fastify';

/** Discord OAuth yapılandırılmış mı — auth rotaları da buna bakar. */
export function isDiscordOAuthConfigured(config: AppConfig): boolean {
  return Boolean(config.DISCORD_CLIENT_ID && config.DISCORD_CLIENT_SECRET);
}

/**
 * Discord bilgileri yoksa plugin HİÇ kaydedilmez ve api yine de açılır.
 *
 * Bunu isteyerek yapıyoruz: planın (Bölüm 8/9) tasarım kararı, Discord
 * kesintisinde panelin ayakta kalması ve break-glass hesabıyla girilebilmesi.
 * Boot'u Discord'a bağlamak, tam da Discord çöktüğünde panele ihtiyaç
 * duyulduğu anda paneli de düşürürdü. Ayrıca ilk kurulumda Discord uygulaması
 * henüz oluşturulmadan sistemi ayağa kaldırmayı mümkün kılıyor.
 */
export async function registerDiscordOAuth(app: FastifyInstance, config: AppConfig) {
  if (!isDiscordOAuthConfigured(config)) {
    app.log.warn(
      'DISCORD_CLIENT_ID/SECRET boş — Discord ile giriş devre dışı. ' +
        'Panel açılıyor; giriş için break-glass hesabını kullanın.',
    );
    return;
  }

  await app.register(fastifyOauth2, {
    name: 'discordOAuth2',
    scope: ['identify', 'guilds.members.read'],
    credentials: {
      client: {
        id: config.DISCORD_CLIENT_ID,
        secret: config.DISCORD_CLIENT_SECRET,
      },
      auth: fastifyOauth2.DISCORD_CONFIGURATION,
    },
    // Önek dışarıdan geliyor: bu plugin `/api` altına kaydedildiği için
    // gerçek adres /api/auth/discord oluyor.
    startRedirectPath: '/auth/discord',
    callbackUri: config.DISCORD_CALLBACK_URL ?? 'http://localhost:3001/auth/discord/callback',
  });
}
