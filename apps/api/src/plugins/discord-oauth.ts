import type { AppConfig } from '@altai/shared';
import fastifyOauth2 from '@fastify/oauth2';
import type { FastifyInstance } from 'fastify';

export async function registerDiscordOAuth(app: FastifyInstance, config: AppConfig) {
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
    startRedirectPath: '/auth/discord',
    callbackUri: config.DISCORD_CALLBACK_URL ?? 'http://localhost:3001/auth/discord/callback',
  });
}
