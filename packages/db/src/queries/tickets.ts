import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import * as accessSchema from '../schema/access.js';
import * as communitySchema from '../schema/community.js';

/**
 * Destek talebi (ticket) iş mantığı — plan Faz 5.
 *
 * NEDEN packages/db İÇİNDE: talep açma ve transkript yazımı BOT'ta
 * (Discord'dan başlıyor), kapatma ve okuma API'de (panelden yapılıyor).
 * İkisinin aynı kuralları uygulaması gerekiyor ve `apps/` altındaki bir
 * modülü diğer uygulama import edemiyor. Kuralların iki kopyası, birinin
 * güncellenip diğerinin unutulacağı bir gelecek demekti.
 *
 * `packages/shared` uygun değildi: orada veritabanı bağımlılığı yok ve
 * logger/config için tutulan bir pakete drizzle sokmak, o paketi kullanan
 * her şeye veritabanı taşımak olurdu.
 */

export const TICKET_DURUMLARI = ['open', 'claimed', 'closed'] as const;
export type TicketDurumu = (typeof TICKET_DURUMLARI)[number];

/**
 * Bir sonraki talep numarası.
 *
 * Guild başına ayrı sayıyor ve TRANSACTION İÇİNDE alınmalı: iki kişi aynı
 * anda talep açtığında ikisine de aynı numarayı vermek, yetkililerin
 * "42 numaralı talep" derken hangisini kastettiğini belirsizleştirirdi.
 * Tekil indeks (guild, number) bu durumda ikinciyi reddediyor; çağıran
 * taraf yeniden deniyor.
 */
export async function sonrakiNumara(db: Db, guildId: string): Promise<number> {
  const res = await db.execute(sql`
    select coalesce(max(number), 0) + 1 as sira
      from tickets
     where discord_guild_id = ${guildId}
  `);
  const r = (res as unknown as Record<string, unknown>[])[0] ?? {};
  return Number(r.sira ?? 1);
}

export interface TalepAcOpts {
  guildId: string;
  discordId: string;
  subject: string;
  category?: string | null;
}

export interface TalepAcSonucu {
  id: string;
  number: number;
}

/**
 * Talep kaydını açar — thread'DEN ÖNCE.
 *
 * Sıra bilinçli: önce kayıt, sonra thread. Tersi olsaydı thread açılıp
 * veritabanı yazımı düştüğünde konuşma hiçbir yere bağlanmadan ortada
 * kalırdı ve kimse fark etmezdi. Bu sırada ise en kötü ihtimalle
 * thread'i olmayan bir kayıt kalıyor; o görünür ve temizlenebilir.
 *
 * Numara çakışırsa (iki kişi aynı anda açtı) BİR KEZ yeniden deniyor.
 * Sonsuz döngü yok: ikinci çakışma gerçek bir sorun işareti ve sessizce
 * dönüp durmaktansa hata vermek yeğ.
 */
export async function talepAc(db: Db, opts: TalepAcOpts): Promise<TalepAcSonucu> {
  const playerId = await oyuncuyuCoz(db, opts.discordId);

  for (let deneme = 0; deneme < 2; deneme++) {
    const number = await sonrakiNumara(db, opts.guildId);
    try {
      const [olusan] = await db
        .insert(communitySchema.tickets)
        .values({
          number,
          subject: opts.subject,
          category: opts.category ?? null,
          openedByDiscordId: opts.discordId,
          openedByPlayerId: playerId,
          discordGuildId: opts.guildId,
          status: 'open',
        })
        .returning({
          id: communitySchema.tickets.id,
          number: communitySchema.tickets.number,
        });
      if (olusan) return olusan;
    } catch (err) {
      // Yalnızca numara çakışmasında yeniden deniyoruz; başka hata
      // yutulmamalı.
      const kod = (err as { code?: string }).code;
      if (kod !== '23505' || deneme === 1) throw err;
    }
  }
  throw new Error('talep numarası üretilemedi');
}

/** Discord kimliğinden oyuncuyu çözer. Bağ yoksa null. */
async function oyuncuyuCoz(db: Db, discordId: string): Promise<string | null> {
  const [bag] = await db
    .select({ playerId: accessSchema.discordLinks.playerId })
    .from(accessSchema.discordLinks)
    .where(
      and(
        eq(accessSchema.discordLinks.discordId, discordId),
        isNull(accessSchema.discordLinks.unlinkedAt),
      ),
    )
    .limit(1);
  return bag?.playerId ?? null;
}

/** Thread açıldıktan sonra kimliğini kayda bağlar. */
export async function threadBagla(db: Db, ticketId: string, threadId: string): Promise<void> {
  await db
    .update(communitySchema.tickets)
    .set({ discordThreadId: threadId, updatedAt: new Date() })
    .where(eq(communitySchema.tickets.id, ticketId));
}

/**
 * Transkripte bir mesaj ekler.
 *
 * `onConflictDoNothing` ŞART: bot yeniden bağlandığında ya da geçmişi
 * tarayarak boşluk doldurduğunda aynı mesaj iki kez gelebiliyor.
 * Kısıt olmasa transkript sessizce ikilenirdi.
 */
export async function mesajEkle(
  db: Db,
  opts: {
    ticketId: string;
    discordMessageId: string;
    authorDiscordId: string;
    authorName?: string | null;
    body: string;
    attachments?: string[] | null;
    sentAt: Date;
  },
): Promise<void> {
  await db
    .insert(communitySchema.ticketMessages)
    .values({
      ticketId: opts.ticketId,
      discordMessageId: opts.discordMessageId,
      authorDiscordId: opts.authorDiscordId,
      authorName: opts.authorName ?? null,
      body: opts.body,
      attachments: opts.attachments && opts.attachments.length > 0 ? opts.attachments : null,
      sentAt: opts.sentAt,
    })
    .onConflictDoNothing();
}

/** Thread kimliğinden talebi bulur. */
export async function threadTalebi(
  db: Db,
  threadId: string,
): Promise<{ id: string; number: number; status: string } | null> {
  const [t] = await db
    .select({
      id: communitySchema.tickets.id,
      number: communitySchema.tickets.number,
      status: communitySchema.tickets.status,
    })
    .from(communitySchema.tickets)
    .where(eq(communitySchema.tickets.discordThreadId, threadId))
    .limit(1);
  return t ?? null;
}

/**
 * Talebi üstlenir.
 *
 * Zaten üstlenilmişse İKİNCİ kişi reddediliyor: iki yetkilinin aynı
 * talebe ayrı ayrı cevap yazması, hem emek israfı hem de talep sahibine
 * çelişkili iki cevap gitmesi demek.
 */
export async function talepUstlen(
  db: Db,
  ticketId: string,
  discordId: string,
): Promise<{ ok: boolean; mevcut?: string }> {
  const [t] = await db
    .select({
      status: communitySchema.tickets.status,
      claimedBy: communitySchema.tickets.claimedByDiscordId,
    })
    .from(communitySchema.tickets)
    .where(eq(communitySchema.tickets.id, ticketId))
    .limit(1);
  if (!t) return { ok: false };
  if (t.status === 'closed') return { ok: false };
  if (t.claimedBy && t.claimedBy !== discordId) return { ok: false, mevcut: t.claimedBy };

  await db
    .update(communitySchema.tickets)
    .set({
      status: 'claimed',
      claimedByDiscordId: discordId,
      claimedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(communitySchema.tickets.id, ticketId));
  return { ok: true };
}

/**
 * Talebi kapatır.
 *
 * Kapalı bir talebi tekrar kapatmak sessizce başarılı SAYILMIYOR: kapanış
 * zamanı ve kapatan kişi moderasyon kaydı ve ikinci bir kapatma o kaydın
 * üzerine yazardı.
 */
export async function talepKapat(
  db: Db,
  ticketId: string,
  opts: { discordId?: string | null; reason?: string | null },
): Promise<boolean> {
  const sonuc = await db
    .update(communitySchema.tickets)
    .set({
      status: 'closed',
      closedByDiscordId: opts.discordId ?? null,
      closeReason: opts.reason ?? null,
      closedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(communitySchema.tickets.id, ticketId),
        // Yalnızca AÇIK talep kapanır.
        isNull(communitySchema.tickets.closedAt),
      ),
    )
    .returning({ id: communitySchema.tickets.id });
  return sonuc.length > 0;
}
