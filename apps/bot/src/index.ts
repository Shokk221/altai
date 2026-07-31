import { logger } from '@altai/shared';
import { Client, GatewayIntentBits } from 'discord.js';

// Faz 0'da sadece login + guildMemberUpdate dinleyip rol senkronunu
// tetiklemeye hazır; killfeed/ticket/vb. Faz 3'te eklenir.
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once('ready', () => {
  logger.info(`bot giriş yaptı: ${client.user?.tag}`);
});

if (process.env.DISCORD_BOT_TOKEN) {
  client.login(process.env.DISCORD_BOT_TOKEN);
} else {
  logger.warn('DISCORD_BOT_TOKEN yok, bot bağlanmıyor (Faz 0 iskelet modu)');
}
