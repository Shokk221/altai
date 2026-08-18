import { createDb } from '@altai/db';
import { logger } from '@altai/shared';
import { Client, GatewayIntentBits, SlashCommandBuilder, type TextChannel } from 'discord.js';
import { createOlayOkuyucu } from './event-reader.js';
import { hesapBagla, hesapCoz } from './linking.js';
import { adminCagrisiGomusu, macSonuGomusu, teamkillGomusu } from './render.js';
import { guildiEsitle, uyeyiEsitle, uyeyiTemizle } from './role-sync.js';

// Botun iki işi var:
//
//  1. ROL SENKRONU — Discord rollerini discord_member_roles'a yansıtmak.
//     Admins.cfg o tablodan üretiliyor, yani "Discord'da rol alınınca oyun
//     içi yetki düşer" garantisi buraya dayanıyor.
//
//  2. OLAY RENDER'I — plugin'lerin ürettiği olayları Discord kanallarına
//     kart olarak basmak (killfeed, maç sonu). Plan Bölüm 6'nın kuralının
//     öbür ucu: plugin Discord'u bilmiyor, bot da oyunu bilmiyor.
//
// Kanal kimliği verilmeyen render KAPALI kalıyor: yanlış kanala mesaj
// basmaktansa hiç basmamak yeğ.

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

/** Kanal kimlikleri .env'den; verilmeyen özellik sessizce kapalı. */
const killfeedKanali = process.env.DISCORD_KILLFEED_CHANNEL_ID;
const macKanali = process.env.DISCORD_MATCH_CHANNEL_ID;
const cagriKanali = process.env.DISCORD_ADMIN_REQUEST_CHANNEL_ID;
/** Çağrı kartında etiketlenecek rol. Verilmezse etiket yok. */
const cagriRolu = process.env.DISCORD_ADMIN_ROLE_ID;

/**
 * Gömüyü kanala basar.
 *
 * Hata YUTULMUYOR ama akışı da durdurmuyor: bir kanalın silinmesi ya da
 * izin kaybı yüzünden bot'un olay okumayı bırakması, sorunun kendisinden
 * daha pahalı olurdu.
 */
async function gomuGonder(
  kanalId: string,
  gomu: ReturnType<typeof teamkillGomusu>,
  icerik?: string,
) {
  try {
    const kanal = await client.channels.fetch(kanalId);
    if (!kanal || !kanal.isTextBased()) {
      logger.warn({ kanalId }, 'kanal bulunamadı ya da metin kanalı değil');
      return;
    }
    await (kanal as TextChannel).send({ embeds: [gomu], ...(icerik ? { content: icerik } : {}) });
  } catch (err) {
    logger.error({ err, kanalId }, 'Discord mesajı gönderilemedi');
  }
}

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

// Yalnızca render'ı açık olan olay türleri okunuyor: kapalı bir özellik
// için veritabanını yoklamanın anlamı yok.
const okunacakTurler = [
  ...(killfeedKanali ? ['TEAMKILL'] : []),
  ...(macKanali ? ['ROUND_ENDED'] : []),
  ...(cagriKanali ? ['ADMIN_REQUEST'] : []),
];

const olayOkuyucu =
  okunacakTurler.length > 0
    ? createOlayOkuyucu({
        db,
        turler: okunacakTurler,
        isle: async (event) => {
          if (event.type === 'TEAMKILL' && killfeedKanali) {
            await gomuGonder(killfeedKanali, teamkillGomusu(event));
            return;
          }
          if (event.type === 'ROUND_ENDED' && macKanali) {
            await gomuGonder(macKanali, macSonuGomusu(event));
            return;
          }
          if (event.type === 'ADMIN_REQUEST' && cagriKanali) {
            // Rol etiketi kartın DIŞINDA: gömü içindeki etiket bildirim
            // üretmiyor, oysa çağrının bütün amacı birinin haberdar olması.
            await gomuGonder(
              cagriKanali,
              adminCagrisiGomusu(event),
              cagriRolu ? `<@&${cagriRolu}>` : undefined,
            );
          }
        },
      })
    : null;

client.once('ready', () => {
  logger.info(`bot giriş yaptı: ${client.user?.tag}`);
  void tamTarama('acilis');
  const zamanlayici = setInterval(() => void tamTarama('periyodik'), TAM_TARAMA_MS);
  zamanlayici.unref?.();

  if (olayOkuyucu) olayOkuyucu.baslat();
  else logger.info({}, 'olay render kanalı tanımlı değil — killfeed ve maç sonu kapalı');

  void komutlariKaydet();
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

/**
 * Slash komutlarını guild'e kaydeder.
 *
 * Guild'e (global'e DEĞİL): global kayıt Discord tarafında bir saate kadar
 * yayılıyor, guild kaydı anında geçerli. Tek sunucuda çalışan bir bot için
 * beklemenin karşılığı yok.
 */
async function komutlariKaydet() {
  try {
    const guild = await client.guilds.fetch(guildId as string);
    await guild.commands.set([
      new SlashCommandBuilder()
        .setName('baglan')
        .setDescription('Steam hesabını Discord hesabına bağlar')
        .addStringOption((o) =>
          o
            .setName('steamid')
            .setDescription('17 haneli SteamID ya da profil bağlantısı')
            .setRequired(true),
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName('bagikaldir')
        .setDescription('Steam hesabı bağını kaldırır')
        .toJSON(),
    ]);
    logger.info({}, 'slash komutları kaydedildi');
  } catch (err) {
    // Komut kaydı başarısız olsa bile bot'un diğer işleri (rol senkronu,
    // render) çalışmaya devam etmeli.
    logger.error({ err }, 'slash komutları kaydedilemedi');
  }
}

/**
 * Hesap bağlama komutları.
 *
 * Sunucuya değil KULLANICIYA özel cevap veriliyor (`ephemeral`): SteamID
 * kişisel bir bilgi ve kanalda herkese göstermenin bir faydası yok.
 */
client.on('interactionCreate', async (etkilesim) => {
  if (!etkilesim.isChatInputCommand()) return;

  try {
    if (etkilesim.commandName === 'baglan') {
      const steamId = etkilesim.options.getString('steamid', true);
      const sonuc = await hesapBagla(db, etkilesim.user.id, steamId);

      const mesaj =
        sonuc.durum === 'baglandi'
          ? 'Hesabın bağlandı. Discord rollerin oyun içi yetkiye dönüşecek.'
          : sonuc.durum === 'zaten_bagli'
            ? `Zaten bağlısın (${sonuc.steamId}). Değiştirmek için önce /bagikaldir yaz.`
            : sonuc.durum === 'steam_baskasinda'
              ? 'Bu Steam hesabı başka bir Discord hesabına bağlı. Yetkiliyle görüş.'
              : 'Geçersiz SteamID. 17 haneli Steam64 kimliği ya da profil bağlantısı gönder.';

      await etkilesim.reply({ content: mesaj, ephemeral: true });
      return;
    }

    if (etkilesim.commandName === 'bagikaldir') {
      const kaldirildi = await hesapCoz(db, etkilesim.user.id);
      await etkilesim.reply({
        content: kaldirildi ? 'Bağın kaldırıldı.' : 'Zaten bağlı bir hesabın yok.',
        ephemeral: true,
      });
    }
  } catch (err) {
    logger.error({ err, komut: etkilesim.commandName }, 'slash komutu işlenemedi');
    // Cevapsız bırakmak Discord'da "uygulama yanıt vermedi" hatası
    // gösteriyor ve kullanıcı komutun çalışmadığını sanıyor.
    if (!etkilesim.replied) {
      await etkilesim
        .reply({ content: 'Komut işlenemedi, birazdan tekrar dene.', ephemeral: true })
        .catch(() => undefined);
    }
  }
});

client.on('error', (err) => {
  logger.error({ err }, 'discord istemci hatası');
});

await client.login(process.env.DISCORD_BOT_TOKEN);

async function shutdown(signal: string) {
  logger.info({ signal }, 'bot kapanıyor');
  olayOkuyucu?.durdur();
  await client.destroy();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
