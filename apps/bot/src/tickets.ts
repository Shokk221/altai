import type { Db } from '@altai/db';
import { mesajEkle, talepAc, talepKapat, talepUstlen, threadBagla, threadTalebi } from '@altai/db';
import { logger } from '@altai/shared';
import {
  ChannelType,
  type Message,
  type TextChannel,
  ThreadAutoArchiveDuration,
  type ThreadChannel,
} from 'discord.js';

/**
 * Destek talepleri — Discord tarafı (plan Faz 5).
 *
 * Talep bir THREAD olarak açılıyor, ayrı kanal olarak değil. Sebep pratik:
 * her talep için kanal açan sistemler birkaç yüz talepten sonra kanal
 * listesini kullanılamaz hâle getiriyor ve Discord'un kanal sınırına
 * dayanıyor. Thread'ler arşivleniyor ve listeyi kirletmiyor.
 *
 * MESAJ İÇERİĞİ AYRICALIKLI BİR İZİN GEREKTİRİYOR. Transkript için
 * `MessageContent` intent'i Discord geliştirici panelinden AÇILMALI
 * (ses durumundaki `GuildVoiceStates`'ten farklı olarak bu ayrıcalıklı).
 * Açık değilse mesajlar boş gövdeyle kaydedilir — bu yüzden bot açılışta
 * durumu kontrol edip uyarıyor, sessizce boş transkript üretmiyor.
 */

/** Talep kaydı + thread açar. */
export async function talepOlustur(
  db: Db,
  kanal: TextChannel,
  opts: { discordId: string; kullaniciAdi: string; subject: string; category?: string | null },
): Promise<{ number: number; thread: ThreadChannel } | { hata: string }> {
  // ÖNCE kayıt, SONRA thread (bkz. packages/db/src/queries/tickets.ts).
  const talep = await talepAc(db, {
    guildId: kanal.guild.id,
    discordId: opts.discordId,
    subject: opts.subject,
    ...(opts.category ? { category: opts.category } : {}),
  });

  try {
    const thread = await kanal.threads.create({
      name: `#${talep.number} · ${opts.subject}`.slice(0, 100),
      // ÖZEL thread: talepler üçüncü kişilere açık olmamalı. Ban itirazı
      // ya da şikayet, herkesin okuyabileceği bir yerde geçmemeli.
      type: ChannelType.PrivateThread,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: `Talep #${talep.number}`,
    });
    await thread.members.add(opts.discordId).catch(() => {
      // Ekleyemezsek thread yine duruyor; yetkili kişiyi elle ekleyebilir.
      logger.warn({ talep: talep.number }, 'talep sahibi thread’e eklenemedi');
    });

    await threadBagla(db, talep.id, thread.id);
    return { number: talep.number, thread };
  } catch (err) {
    // Thread açılamadı ama KAYIT DURUYOR: talebin varlığı kayboldu
    // sayılmaz ve panelden görülüp elle ele alınabilir.
    logger.error({ err, talep: talep.number }, 'talep thread’i açılamadı — kayıt duruyor');
    return { hata: 'thread_acilamadi' };
  }
}

/**
 * Thread'e düşen mesajı transkripte yazar.
 *
 * Bot'un KENDİ mesajları da yazılıyor: yetkilinin bot üzerinden verdiği
 * cevap da konuşmanın parçası ve transkriptten düşmesi, sonradan
 * bakıldığında cevabın hiç verilmediği izlenimini verirdi. Yalnızca
 * sistem bildirimleri (thread açıldı vb.) atlanıyor.
 */
export async function mesajiKaydet(db: Db, mesaj: Message): Promise<void> {
  if (!mesaj.channel.isThread()) return;
  if (mesaj.system) return;

  const talep = await threadTalebi(db, mesaj.channel.id);
  if (!talep) return;

  await mesajEkle(db, {
    ticketId: talep.id,
    discordMessageId: mesaj.id,
    authorDiscordId: mesaj.author.id,
    authorName: mesaj.author.username,
    body: mesaj.content ?? '',
    attachments: [...mesaj.attachments.values()].map((a) => a.url),
    sentAt: mesaj.createdAt,
  });
}

/**
 * Thread'in geçmişini tarayıp eksik mesajları tamamlar.
 *
 * Bot kapalıyken yazılanlar hiçbir olayla gelmiyor. Kapanış anında
 * çağrılıyor: transkript o an eksiksiz olmalı, çünkü sonradan bakılan
 * şey bu.
 *
 * `onConflictDoNothing` sayesinde zaten kayıtlı mesajlar ikilenmiyor.
 */
export async function gecmisiTara(db: Db, thread: ThreadChannel): Promise<number> {
  const talep = await threadTalebi(db, thread.id);
  if (!talep) return 0;

  let yazilan = 0;
  let once: string | undefined;
  // Discord tek seferde en fazla 100 mesaj veriyor; sayfalı okuyoruz.
  // Üst sınır var: binlerce mesajlık bir thread'de kapanışı süresiz
  // bekletmek, kapatan kişiye bir şeyin takıldığını düşündürürdü.
  for (let sayfa = 0; sayfa < 10; sayfa++) {
    const parti = await thread.messages.fetch({ limit: 100, ...(once ? { before: once } : {}) });
    if (parti.size === 0) break;

    for (const mesaj of parti.values()) {
      if (mesaj.system) continue;
      await mesajEkle(db, {
        ticketId: talep.id,
        discordMessageId: mesaj.id,
        authorDiscordId: mesaj.author.id,
        authorName: mesaj.author.username,
        body: mesaj.content ?? '',
        attachments: [...mesaj.attachments.values()].map((a) => a.url),
        sentAt: mesaj.createdAt,
      });
      yazilan++;
    }
    once = parti.last()?.id;
    if (parti.size < 100) break;
  }
  return yazilan;
}

/**
 * Talebi kapatır: geçmişi tamamlar, kaydı kapatır, thread'i arşivler.
 *
 * SIRA ÖNEMLİ. Önce transkript tamamlanıyor, sonra thread kilitleniyor.
 * Tersi olsaydı kilitli bir thread'den mesaj okumaya çalışırdık ve
 * kapanış anında eksik kalan mesajlar sonsuza kadar eksik kalırdı.
 */
export async function talebiKapat(
  db: Db,
  thread: ThreadChannel,
  opts: { discordId?: string | null; reason?: string | null },
): Promise<{ ok: boolean; tarandi: number }> {
  const tarandi = await gecmisiTara(db, thread);

  const talep = await threadTalebi(db, thread.id);
  if (!talep) return { ok: false, tarandi };

  const kapandi = await talepKapat(db, talep.id, opts);

  try {
    await thread.setLocked(true);
    await thread.setArchived(true);
  } catch (err) {
    // Arşivleme başarısız olsa da kayıt kapandı; thread'in açık kalması
    // rahatsız edici ama veri kaybı değil.
    logger.warn({ err, thread: thread.id }, 'talep thread’i arşivlenemedi');
  }

  return { ok: kapandi, tarandi };
}

/** Talebi üstlenir (Discord tarafı sarmalayıcısı). */
export async function talebiUstlen(
  db: Db,
  threadId: string,
  discordId: string,
): Promise<{ ok: boolean; mevcut?: string; number?: number }> {
  const talep = await threadTalebi(db, threadId);
  if (!talep) return { ok: false };
  const sonuc = await talepUstlen(db, talep.id, discordId);
  return { ...sonuc, number: talep.number };
}
