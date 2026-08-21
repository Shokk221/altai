import { communitySchema } from '@altai/db';
import type { Db } from '@altai/db';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../lib/auth-guard.js';

/**
 * Sunucu kuralları — plan Faz 5 ("kurallar yöneticisi").
 *
 * Eski sistemde kurallar üç ayrı yerde yazılıydı (Discord kanalı, sunucu
 * açıklaması, bir plugin'in config'i) ve üçü birbirini tutmuyordu. Burası
 * tek kaynak; oyun içi `!kurallar` komutu da, panel de, bot da buradan
 * okuyor.
 *
 * OKUMA ile YAZMA farklı yetkilerde: kuralları görmek panele giren
 * herkesin hakkı (`player.view`), değiştirmek `rules.manage` istiyor.
 * Aynı yetkiye bağlamak, kuralları okuyabilmek için düzenleme yetkisi
 * vermek olurdu.
 */

const uuid = z.string().uuid();

const KuralBody = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
  category: z.string().trim().max(60).nullish(),
  /** null = tüm sunucularda geçerli genel kural. */
  serverId: uuid.nullish(),
  position: z.number().int().min(0).max(9999).optional(),
  active: z.boolean().optional(),
});

const SiraBody = z.object({
  /** Kural kimlikleri, İSTENEN sırada. */
  ids: z.array(uuid).min(1).max(200),
});

function ilkHata(err: z.ZodError): string {
  const i = err.issues[0];
  if (!i) return 'geçersiz girdi';
  return i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message;
}

export async function ruleRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const okuGuard = requireSession(db, 'player.view');
  const yazGuard = requireSession(db, 'rules.manage');

  /**
   * Kural listesi.
   *
   * `serverId` verilirse o sunucunun kuralları + genel kurallar birlikte
   * dönüyor. Yalnızca sunucuya özel olanları döndürmek, genel kuralların
   * o sunucuda geçersiz olduğu izlenimi verirdi.
   *
   * Pasifler varsayılan olarak GİZLİ; `?all=1` ile geliyor. Panelde
   * düzenleyen kişi pasifleri de görmeli, oyun içi liste görmemeli.
   */
  app.get<{ Querystring: { serverId?: string; all?: string } }>(
    '/rules',
    { preHandler: okuGuard },
    async (req, reply) => {
      const serverId = req.query.serverId;
      if (serverId !== undefined && !uuid.safeParse(serverId).success) {
        return reply.code(400).send({ error: 'gecersiz_sunucu_id' });
      }

      const kosullar = [];
      if (serverId) {
        kosullar.push(
          or(
            eq(communitySchema.serverRules.serverId, serverId),
            isNull(communitySchema.serverRules.serverId),
          ),
        );
      }
      if (req.query.all !== '1') {
        kosullar.push(eq(communitySchema.serverRules.active, true));
      }

      const satirlar = await db
        .select()
        .from(communitySchema.serverRules)
        .where(kosullar.length > 0 ? and(...kosullar) : undefined)
        .orderBy(asc(communitySchema.serverRules.position), asc(communitySchema.serverRules.title));

      return { rules: satirlar };
    },
  );

  app.post('/rules', { preHandler: yazGuard }, async (req, reply) => {
    const parsed = KuralBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: ilkHata(parsed.error) });
    const d = parsed.data;

    // Sıra verilmediyse SONA ekleniyor. Sıfır vermek, yeni kuralı listenin
    // başına atıp mevcut numaralandırmayı kaydırırdı; oyunculara duyurulan
    // "3. kural" bir anda başka bir kural olurdu.
    const position = d.position ?? (await sonrakiSira(db, d.serverId ?? null));

    const [olusan] = await db
      .insert(communitySchema.serverRules)
      .values({
        title: d.title,
        body: d.body,
        category: d.category ?? null,
        serverId: d.serverId ?? null,
        position,
        active: d.active ?? true,
        updatedBy: req.authSession?.id ?? null,
      })
      .returning();

    return reply.code(201).send({ rule: olusan });
  });

  app.patch<{ Params: { id: string } }>(
    '/rules/:id',
    { preHandler: yazGuard },
    async (req, reply) => {
      if (!uuid.safeParse(req.params.id).success) {
        return reply.code(400).send({ error: 'gecersiz_kural_id' });
      }
      const parsed = KuralBody.partial().safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: ilkHata(parsed.error) });
      const d = parsed.data;

      const [guncel] = await db
        .update(communitySchema.serverRules)
        .set({
          ...(d.title !== undefined ? { title: d.title } : {}),
          ...(d.body !== undefined ? { body: d.body } : {}),
          ...(d.category !== undefined ? { category: d.category ?? null } : {}),
          ...(d.serverId !== undefined ? { serverId: d.serverId ?? null } : {}),
          ...(d.position !== undefined ? { position: d.position } : {}),
          ...(d.active !== undefined ? { active: d.active } : {}),
          updatedAt: new Date(),
          updatedBy: req.authSession?.id ?? null,
        })
        .where(eq(communitySchema.serverRules.id, req.params.id))
        .returning();

      if (!guncel) return reply.code(404).send({ error: 'kural_bulunamadi' });
      return { rule: guncel };
    },
  );

  /**
   * Kuralı pasifleştirir — SİLMEZ.
   *
   * Geçmiş moderasyon kayıtları kurallara atıfta bulunuyor ("2. kuraldan
   * ban"). Satırı silmek o kayıtları anlamsızlaştırırdı. Gerçekten silmek
   * gerekiyorsa veritabanından elle yapılır ve bu bilinçli bir zorluk.
   */
  app.delete<{ Params: { id: string } }>(
    '/rules/:id',
    { preHandler: yazGuard },
    async (req, reply) => {
      if (!uuid.safeParse(req.params.id).success) {
        return reply.code(400).send({ error: 'gecersiz_kural_id' });
      }
      const [guncel] = await db
        .update(communitySchema.serverRules)
        .set({ active: false, updatedAt: new Date(), updatedBy: req.authSession?.id ?? null })
        .where(eq(communitySchema.serverRules.id, req.params.id))
        .returning({ id: communitySchema.serverRules.id });

      if (!guncel) return reply.code(404).send({ error: 'kural_bulunamadi' });
      return { ok: true };
    },
  );

  /**
   * Sırayı toplu günceller.
   *
   * Tek tek `position` yazmak yerine tüm liste geliyor: kuralları
   * yeniden sıralamak doğası gereği toplu bir iş ve tek tek yazma,
   * arada bir isteğin düşmesi hâlinde iki kuralı aynı sıraya
   * getirebilirdi.
   */
  app.post('/rules/sira', { preHandler: yazGuard }, async (req, reply) => {
    const parsed = SiraBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: ilkHata(parsed.error) });

    await db.transaction(async (tx) => {
      let sira = 0;
      for (const id of parsed.data.ids) {
        await tx
          .update(communitySchema.serverRules)
          .set({ position: sira, updatedAt: new Date() })
          .where(eq(communitySchema.serverRules.id, id));
        sira++;
      }
    });

    return { ok: true, guncellenen: parsed.data.ids.length };
  });
}

/** Listenin sonundaki sıra numarası + 1. */
async function sonrakiSira(db: Db, serverId: string | null): Promise<number> {
  const res = await db.execute(sql`
    select coalesce(max(position), -1) + 1 as sira
      from server_rules
     where server_id is not distinct from ${serverId}
  `);
  const r = (res as unknown as Record<string, unknown>[])[0] ?? {};
  return Number(r.sira ?? 0);
}
