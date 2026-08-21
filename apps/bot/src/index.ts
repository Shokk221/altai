import { createDb } from '@altai/db';
import { logger } from '@altai/shared';
import {
  ChannelType,
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  type TextChannel,
} from 'discord.js';
import { createOlayOkuyucu } from './event-reader.js';
import { hesapBagla, hesapCoz } from './linking.js';
import { adminCagrisiGomusu, macSonuGomusu, teamkillGomusu } from './render.js';
import { guildiEsitle, uyeyiEsitle, uyeyiTemizle } from './role-sync.js';
import { mesajiKaydet, talebiKapat, talebiUstlen, talepOlustur } from './tickets.js';
import { type SesUyesi, sesDurumuDegisti, sesDurumunuEsitle, sesNabzi } from './voice.js';

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

/**
 * Ses nabız aralığı.
 *
 * api bunun iki katından eskiyse ses bilgisini "bilinmiyor" sayıyor. Kısa
 * tutuluyor çünkü bir yetkilinin haksız yere uyarılmaması, tek satırlık
 * bir yazmadan daha değerli.
 */
const SES_NABIZ_MS = 30 * 1000;

/**
 * Talep kanalı — thread'ler burada açılıyor. Verilmezse ticket sistemi
 * sessizce kapalı (kanal kimliği olmadan nereye açılacağı bilinmiyor).
 */
const ticketKanali = process.env.DISCORD_TICKET_CHANNEL_ID;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    // Transkript için thread mesajları okunuyor.
    GatewayIntentBits.GuildMessages,
    // AYRICALIKLI INTENT: Discord geliştirici panelinden acikca
    // acilmali. Kapaliysa mesaj govdeleri BOS geliyor ve transkript
    // sessizce ise yaramaz hale geliyor — bu yuzden acilista kontrol
    // edilip uyariliyor (bkz. ready).
    GatewayIntentBits.MessageContent,
    // Ses durumu ayrı bir intent ve Discord panelinden ayrıca açılması
    // gerekmiyor (ayrıcalıklı değil). Olmadan voiceStateUpdate hiç düşmez
    // ve ses denetimi sessizce çalışmaz.
    GatewayIntentBits.GuildVoiceStates,
  ],
});

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

/**
 * Guild'deki ses durumunu baştan yazar.
 *
 * Açılışta ve periyodik olarak çağrılıyor. Periyodik olması şart:
 * `voiceStateUpdate` bot kapalıyken düşen değişiklikleri getirmiyor ve
 * yeniden bağlanma sırasında da olay kaçabiliyor. Tam tarama, kaçan her
 * şeyi bir sonraki turda düzeltiyor.
 */
async function sesTaramasi(sebep: string) {
  try {
    const guild = await client.guilds.fetch(guildId as string);
    const uyeler: SesUyesi[] = [];
    for (const [, durum] of guild.voiceStates.cache) {
      // Kanalı olmayan ses durumu = sesten çıkmış; önbellekte kalıntı
      // olarak durabiliyor.
      if (!durum.channelId) continue;
      uyeler.push({
        discordId: durum.id,
        channelId: durum.channelId,
        channelName: durum.channel?.name ?? null,
      });
    }
    const sonuc = await sesDurumunuEsitle(db, guildId as string, uyeler);
    // Nabız senkronun ARDINDAN atılıyor: önce atılsaydı, senkron
    // başarısız olduğunda bayat veri taze görünürdü.
    await sesNabzi(db);
    logger.info({ sebep, ...sonuc }, 'ses durumu senkronu tamamlandı');
  } catch (err) {
    // Nabız ATILMIYOR: senkron başarısızsa veri bayat demektir ve api'nin
    // bunu bilmesi gerekiyor. Nabzı yine de atmak, bayat veriyi taze
    // göstermek olurdu.
    logger.error({ err, sebep }, 'ses durumu senkronu başarısız — nabız atılmadı');
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

  void sesTaramasi('acilis');
  const sesZamanlayici = setInterval(() => void sesTaramasi('periyodik'), SES_NABIZ_MS);
  sesZamanlayici.unref?.();

  if (olayOkuyucu) olayOkuyucu.baslat();
  else logger.info({}, 'olay render kanalı tanımlı değil — killfeed ve maç sonu kapalı');

  if (ticketKanali) {
    // MessageContent AYRICALIKLI bir intent ve Discord panelinden
    // acilmasi gerekiyor. Kapaliysa gateway baglantisi yine kuruluyor
    // ama mesaj govdeleri BOS geliyor: transkript satir satir doluyor
    // ama icerigi olmuyor. Sessiz basarisizligin en kotu turu, cunku
    // sorun ancak aylar sonra bir talebe geri donuldugunde fark edilir.
    logger.info(
      {},
      'talep sistemi acik — transkript icin Discord panelinde MESSAGE CONTENT INTENT acik olmali',
    );
  } else {
    logger.info({}, 'DISCORD_TICKET_CHANNEL_ID tanimli degil — talep sistemi kapali');
  }

  void komutlariKaydet();
});

client.on('guildMemberUpdate', (_eski, yeni) => {
  if (yeni.guild.id !== guildId) return;
  void uyeyiEsitle(db, yeni).catch((err) =>
    logger.error({ err, discordId: yeni.id }, 'üye rol senkronu başarısız'),
  );
});

/**
 * Talep thread'lerindeki her mesaj transkripte yazılıyor.
 *
 * Thread OLMAYAN mesajlar hızlıca eleniyor: sunucudaki bütün sohbeti
 * veritabanına sormak, dakikada yüzlerce gereksiz sorgu demekti.
 */
client.on('messageCreate', (mesaj) => {
  if (!ticketKanali) return;
  if (!mesaj.channel.isThread()) return;
  void mesajiKaydet(db, mesaj).catch((err) =>
    logger.error({ err, mesaj: mesaj.id }, 'talep mesajı kaydedilemedi'),
  );
});

client.on('voiceStateUpdate', (_eski, yeni) => {
  if (yeni.guild.id !== guildId) return;
  void sesDurumuDegisti(
    db,
    guildId as string,
    yeni.id,
    yeni.channelId ? { id: yeni.channelId, name: yeni.channel?.name ?? null } : null,
  ).catch((err) => logger.error({ err, discordId: yeni.id }, 'ses durumu yazılamadı'));
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
      // Talep komutları yalnızca kanal tanımlıysa kaydediliyor: var olan
      // ama çalışmayan bir komut, kullanıcıya sistemin bozuk olduğunu
      // düşündürür.
      ...(ticketKanali
        ? [
            new SlashCommandBuilder()
              .setName('talep')
              .setDescription('Yetkililere destek talebi açar')
              .addStringOption((o) =>
                o.setName('konu').setDescription('Kısa başlık').setRequired(true),
              )
              .addStringOption((o) =>
                o
                  .setName('kategori')
                  .setDescription('Ban itirazı, şikayet, başvuru...')
                  .setRequired(false),
              )
              .toJSON(),
            new SlashCommandBuilder()
              .setName('ustlen')
              .setDescription('Bu talebi üstlenir (talep thread’inde çalışır)')
              .toJSON(),
            new SlashCommandBuilder()
              .setName('kapat')
              .setDescription('Bu talebi kapatır (talep thread’inde çalışır)')
              .addStringOption((o) =>
                o.setName('sebep').setDescription('Kapanış notu').setRequired(false),
              )
              .toJSON(),
          ]
        : []),
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

    if (etkilesim.commandName === 'talep') {
      if (!ticketKanali) return;
      const kanal = await client.channels.fetch(ticketKanali);
      if (!kanal || kanal.type !== ChannelType.GuildText) {
        await etkilesim.reply({ content: 'Talep kanalı bulunamadı.', ephemeral: true });
        return;
      }

      // Talep açmak birkaç saniye sürebiliyor (thread + üye ekleme);
      // Discord 3 saniyede cevap bekliyor ve o süre aşılırsa etkileşim
      // "başarısız" görünüyordu.
      await etkilesim.deferReply({ ephemeral: true });

      const sonuc = await talepOlustur(db, kanal as TextChannel, {
        discordId: etkilesim.user.id,
        kullaniciAdi: etkilesim.user.username,
        subject: etkilesim.options.getString('konu', true),
        category: etkilesim.options.getString('kategori'),
      });

      if ('hata' in sonuc) {
        await etkilesim.editReply(
          'Talep kaydedildi ama thread açılamadı. Yetkililer panelden görecek.',
        );
        return;
      }
      await etkilesim.editReply(`Talebin açıldı: ${sonuc.thread} (#${sonuc.number})`);
      return;
    }

    if (etkilesim.commandName === 'ustlen') {
      if (!etkilesim.channel?.isThread()) {
        await etkilesim.reply({ content: 'Bu komut talep thread’inde çalışır.', ephemeral: true });
        return;
      }
      const sonuc = await talebiUstlen(db, etkilesim.channel.id, etkilesim.user.id);
      await etkilesim.reply({
        content: sonuc.ok
          ? `Talep #${sonuc.number} sende.`
          : sonuc.mevcut
            ? `Bu talebi zaten <@${sonuc.mevcut}> üstlendi.`
            : 'Bu thread bir talebe bağlı değil ya da talep kapalı.',
        // Üstlenme HERKESE görünür: talep sahibinin de kiminle
        // konuştuğunu bilmesi gerekiyor.
        ephemeral: !sonuc.ok,
      });
      return;
    }

    if (etkilesim.commandName === 'kapat') {
      if (!etkilesim.channel?.isThread()) {
        await etkilesim.reply({ content: 'Bu komut talep thread’inde çalışır.', ephemeral: true });
        return;
      }
      // Geçmiş taraması yüzünden uzun sürebiliyor.
      await etkilesim.deferReply();
      const sonuc = await talebiKapat(db, etkilesim.channel, {
        discordId: etkilesim.user.id,
        reason: etkilesim.options.getString('sebep'),
      });
      await etkilesim.editReply(
        sonuc.ok
          ? `Talep kapatıldı. Transkript panele işlendi (${sonuc.tarandi} mesaj tarandı).`
          : 'Bu thread bir talebe bağlı değil ya da talep zaten kapalı.',
      );
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
