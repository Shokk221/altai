import type { Db } from '@altai/db';
import { communitySchema, talepKapat } from '@altai/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../lib/auth-guard.js';

/**
 * Destek talepleri — panel yüzeyi (plan Faz 5, "web aynası + transkript").
 *
 * Panel OKUMA ve KAPATMA yapıyor, cevap YAZMIYOR. Konuşmanın tek yeri
 * Discord thread'i: panelden yazılan bir cevabın talep sahibine ulaşması
 * için bot'un onu thread'e basması gerekir ve o an bot kapalıysa mesaj
 * hiçbir yere gitmeden "gönderildi" görünürdü. Tek yönlü ayna, yanlış
 * gönderilmiş sayılan bir mesajdan iyidir.
 *
 * İzin `ticket.manage`: talepler ban itirazı ve şikayet içeriyor, oyuncu
 * profiline bakabilen herkese açık olmamalı.
 */

const uuid = z.string().uuid();

const KapatBody = z.object({
  reason: z.string().trim().max(500).nullish(),
});

export async function ticketRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const guard = requireSession(db, 'ticket.manage');

  /**
   * Talep listesi.
   *
   * Varsayılan olarak KAPALILAR DA geliyor ama sona sıralanmış değil —
   * `status` süzgeci açıkça veriliyor. Kapalıları varsayılan olarak
   * gizlemek, "talebim kayboldu" diyen kişiye bakan yetkiliyi yanıltırdı.
   */
  app.get<{ Querystring: { status?: string; limit?: string } }>(
    '/tickets',
    { preHandler: guard },
    async (req) => {
      const durum = req.query.status;
      const limitHam = Number(req.query.limit ?? 50);
      const limit = Number.isInteger(limitHam) ? Math.min(Math.max(limitHam, 1), 200) : 50;

      const kosul =
        durum === 'open' || durum === 'claimed' || durum === 'closed'
          ? eq(communitySchema.tickets.status, durum)
          : undefined;

      const satirlar = await db
        .select()
        .from(communitySchema.tickets)
        .where(kosul)
        .orderBy(desc(communitySchema.tickets.createdAt))
        .limit(limit);

      // Mesaj sayısı listede gösteriliyor: boş bir talep ile uzun bir
      // tartışma, açmadan önce ayırt edilebilmeli.
      const sayilar = await db.execute(sql`
        select ticket_id, count(*)::int as adet
          from ticket_messages
         group by ticket_id
      `);
      const sayiHarita = new Map(
        (sayilar as unknown as Record<string, unknown>[]).map((r) => [
          String(r.ticket_id),
          Number(r.adet ?? 0),
        ]),
      );

      return {
        tickets: satirlar.map((t) => ({ ...t, mesajSayisi: sayiHarita.get(t.id) ?? 0 })),
      };
    },
  );

  /** Tek talep + tam transkript. */
  app.get<{ Params: { id: string } }>('/tickets/:id', { preHandler: guard }, async (req, reply) => {
    if (!uuid.safeParse(req.params.id).success) {
      return reply.code(400).send({ error: 'gecersiz_talep_id' });
    }

    const [talep] = await db
      .select()
      .from(communitySchema.tickets)
      .where(eq(communitySchema.tickets.id, req.params.id))
      .limit(1);
    if (!talep) return reply.code(404).send({ error: 'talep_bulunamadi' });

    const mesajlar = await db
      .select()
      .from(communitySchema.ticketMessages)
      .where(eq(communitySchema.ticketMessages.ticketId, req.params.id))
      // Gönderim zamanına göre, kayıt sırasına göre DEĞİL: geçmiş taraması
      // mesajları yeniden eskiye yazıyor ve kayıt sırası konuşmayı ters
      // gösterirdi.
      .orderBy(communitySchema.ticketMessages.sentAt);

    return { ticket: talep, mesajlar };
  });

  /**
   * Talebi panelden kapatır.
   *
   * Discord thread'i BURADAN arşivlenmiyor — api'nin Discord istemcisi
   * yok. Bot bir sonraki taramada kapalı talebin thread'ini kapatacak;
   * o zamana kadar thread açık kalıyor ve bu bilinçli bir gecikme.
   * Kayıt kapandığı için panelde doğru görünüyor.
   */
  app.post<{ Params: { id: string } }>(
    '/tickets/:id/kapat',
    { preHandler: guard },
    async (req, reply) => {
      if (!uuid.safeParse(req.params.id).success) {
        return reply.code(400).send({ error: 'gecersiz_talep_id' });
      }
      const parsed = KapatBody.safeParse(req.body ?? {});
      if (!parsed.success) return reply.code(400).send({ error: 'gecersiz_govde' });

      const kapandi = await talepKapat(db, req.params.id, {
        discordId: null,
        reason: parsed.data.reason ?? null,
      });

      // Zaten kapalıysa 409: sessizce başarılı dönmek, kapanış kaydının
      // (kim, ne zaman) üzerine yazıldığı izlenimi verirdi.
      if (!kapandi) return reply.code(409).send({ error: 'talep_zaten_kapali' });
      return { ok: true };
    },
  );

  /** Bir oyuncunun talepleri — profil sayfası için. */
  app.get<{ Params: { id: string } }>(
    '/players/:id/tickets',
    { preHandler: guard },
    async (req, reply) => {
      if (!uuid.safeParse(req.params.id).success) {
        return reply.code(400).send({ error: 'gecersiz_oyuncu_id' });
      }
      const satirlar = await db
        .select({
          id: communitySchema.tickets.id,
          number: communitySchema.tickets.number,
          subject: communitySchema.tickets.subject,
          status: communitySchema.tickets.status,
          createdAt: communitySchema.tickets.createdAt,
          closedAt: communitySchema.tickets.closedAt,
        })
        .from(communitySchema.tickets)
        .where(and(eq(communitySchema.tickets.openedByPlayerId, req.params.id)))
        .orderBy(desc(communitySchema.tickets.createdAt))
        .limit(50);
      return { tickets: satirlar };
    },
  );
}
