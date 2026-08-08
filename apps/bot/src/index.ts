import { logger } from '@altai/shared';
import { Client, GatewayIntentBits } from 'discord.js';

// Faz 0'da sadece login + guildMemberUpdate dinleyip rol senkronunu
// tetiklemeye hazır; killfeed/ticket/vb. Faz 3'te eklenir.

if (!process.env.DISCORD_BOT_TOKEN) {
  // Token yoksa yapacak iş yok ve süreç hemen biter — discord.js olmadan
  // event loop'u meşgul tutan bir şey kalmıyor.
  //
  // Mesajı pino ile DEĞİL doğrudan stderr'e yazıyoruz: pino asenkron yazıyor
  // ve süreç hemen kapandığı için log kayboluyordu. Sonuç, supervisord'da
  // sebepsiz görünen bir FATAL'dı.
  process.stderr.write(
    'DISCORD_BOT_TOKEN tanımlı değil — bot bağlanmadan çıkıyor.\n' +
      "Panel ve agent bundan etkilenmez. Token .env'e eklenip " +
      '`supervisorctl restart bot` çalıştırılınca bağlanır.\n',
  );
  process.exit(0);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

client.once('ready', () => {
  logger.info(`bot giriş yaptı: ${client.user?.tag}`);
});

client.on('error', (err) => {
  logger.error({ err }, 'discord istemci hatası');
});

await client.login(process.env.DISCORD_BOT_TOKEN);

async function shutdown(signal: string) {
  logger.info({ signal }, 'bot kapanıyor');
  await client.destroy();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
