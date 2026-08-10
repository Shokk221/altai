import { createDb } from '@altai/db';
import { logger } from '@altai/shared';
import { Client, GatewayIntentBits } from 'discord.js';
import { guildiEsitle, uyeyiEsitle, uyeyiTemizle } from './role-sync.js';

// Botun tek işi şimdilik ROL SENKRONU: Discord'daki rolleri
// discord_member_roles tablosuna yansıtmak. Admins.cfg o tablodan üretiliyor,
// yani "Discord'da rol alınınca oyun içi yetki düşer" garantisi buraya
// dayanıyor. Killfeed/ticket gibi işler Faz 3.

if (!process.env.DISCORD_BOT_TOKEN) {
  // Token yoksa yapacak iş yok ve süreç hemen biter.
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

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write('DATABASE_URL tanımlı değil — rol senkronu yapılamaz.\n');
  process.exit(1);
}
const guildId = process.env.DISCORD_GUILD_ID;
if (!guildId) {
  process.stderr.write('DISCORD_GUILD_ID tanımlı değil — hangi sunucu olduğu bilinmiyor.\n');
  process.exit(1);
}

const db = createDb(databaseUrl);

/**
 * Tam tarama aralığı.
 *
 * `guildMemberUpdate` olayı çoğu değişikliği anında getiriyor; tam tarama
 * bot kapalıyken kaçırılanlar için. 15 dakika, "yetki bir çeyrek saatten
 * fazla bayat kalmasın" ile "her seferinde bütün üyeleri çekmeyelim"
 * arasında bir denge.
 */
const TAM_TARAMA_MS = 15 * 60 * 1000;

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });

async function tamTarama(sebep: string) {
  try {
    const guild = await client.guilds.fetch(guildId as string);
    // Collection, Map'i genişletiyor — senkron katmanı sade bir Map alıyor.
    const uyeler = await guild.members.fetch();
    const sonuc = await guildiEsitle(db, uyeler);
    logger.info({ sebep, ...sonuc }, 'rol senkronu tamamlandı');
  } catch (err) {
    // Senkron başarısız olursa tablo ESKİ hâliyle kalır ve admin listesi
    // son bilinen doğru durumu servis etmeye devam eder. Tabloyu boşaltmak
    // sunucudaki tüm adminleri silmek olurdu.
    logger.error({ err, sebep }, 'rol senkronu başarısız — tablo değiştirilmedi');
  }
}

client.once('ready', () => {
  logger.info(`bot giriş yaptı: ${client.user?.tag}`);
  void tamTarama('acilis');
  const zamanlayici = setInterval(() => void tamTarama('periyodik'), TAM_TARAMA_MS);
  zamanlayici.unref?.();
});

client.on('guildMemberUpdate', (_eski, yeni) => {
  if (yeni.guild.id !== guildId) return;
  void uyeyiEsitle(db, yeni).catch((err) =>
    logger.error({ err, discordId: yeni.id }, 'üye rol senkronu başarısız'),
  );
});

// Üye ayrıldığında rolleri de gitmeli: ayrılan biri Admins.cfg'de kalmamalı.
client.on('guildMemberRemove', (uye) => {
  if (uye.guild.id !== guildId) return;
  void uyeyiTemizle(db, uye.id).catch((err) =>
    logger.error({ err, discordId: uye.id }, 'ayrılan üye temizlenemedi'),
  );
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
