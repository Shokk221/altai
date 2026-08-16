import type { Db } from '@altai/db';
import { identitySchema } from '@altai/db';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../lib/auth-guard.js';
import { uyeCikar, uyeEkle } from '../lib/clans.js';

/**
 * Klan yönetimi — panel yüzeyi.
 *
 * Üyelik SteamID listesiyle yönetiliyor (bkz. lib/clans.ts). Uçlar
 * bilinçli olarak toplu çalışıyor: klan yöneticisi tek tek oyuncu
 * eklemiyor, listeyi olduğu gibi yapıştırıyor.
 */

const uuid = z.string().uuid();

const KlanBody = z.object({
  name: z.string().trim().min(1).max(100),
  tag: z.string().trim().min(1).max(16).nullish(),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
});

const UyeBody = z.object({
  /** Serbest metin: satır sonu, virgül, boşluk ya da profil bağlantısı. */
  steamIds: z.string().min(1).max(100_000),
});

function ilkHata(err: z.ZodError): string {
  const i = err.issues[0];
  if (!i) return 'geçersiz girdi';
  return i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message;
}

export async function clanRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  // Klan üyeliği takım dengelemesini etkiliyor — sunucu kontrolü yetkisi.
  const guard = requireSession(db, 'plugin_config.write');

  app.get('/clans', { preHandler: guard }, async () => {
    const satirlar = await db
      .select({
        id: identitySchema.clans.id,
        name: identitySchema.clans.name,
        tag: identitySchema.clans.tag,
        color: identitySchema.clans.color,
        uyeSayisi: sql<number>`count(${identitySchema.clanMembers.id})`,
      })
      .from(identitySchema.clans)
      .leftJoin(
        identitySchema.clanMembers,
        and(
          eq(identitySchema.clanMembers.clanId, identitySchema.clans.id),
          isNull(identitySchema.clanMembers.removedAt),
        ),
      )
      .groupBy(identitySchema.clans.id)
      .orderBy(asc(identitySchema.clans.name));

    return { clans: satirlar.map((s) => ({ ...s, uyeSayisi: Number(s.uyeSayisi) })) };
  });

  app.post('/clans', { preHandler: guard }, async (req, reply) => {
    const parsed = KlanBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: ilkHata(parsed.error) });

    const [olusan] = await db
      .insert(identitySchema.clans)
      .values({
        name: parsed.data.name,
        tag: parsed.data.tag ?? null,
        color: parsed.data.color ?? null,
      })
      .onConflictDoNothing()
      .returning({ id: identitySchema.clans.id });

    // Ad tekil: aynı adla ikinci klan, üyelerin hangisine gittiğini
    // belirsizleştirir ve takım dengeleyici ikisini ayrı klan sayar.
    if (!olusan) return reply.code(409).send({ error: 'bu adda bir klan zaten var' });
    return reply.code(201).send({ id: olusan.id });
  });

  app.get('/clans/:id/members', { preHandler: guard }, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'geçersiz id' });

    const uyeler = await db
      .select({
        playerId: identitySchema.players.id,
        steamId: identitySchema.players.steamId,
        eosId: identitySchema.players.eosId,
        addedAt: identitySchema.clanMembers.addedAt,
      })
      .from(identitySchema.clanMembers)
      .innerJoin(
        identitySchema.players,
        eq(identitySchema.players.id, identitySchema.clanMembers.playerId),
      )
      .where(
        and(
          eq(identitySchema.clanMembers.clanId, id.data),
          isNull(identitySchema.clanMembers.removedAt),
        ),
      )
      .orderBy(asc(identitySchema.clanMembers.addedAt));

    return { members: uyeler };
  });

  app.post('/clans/:id/members', { preHandler: guard }, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'geçersiz id' });

    const parsed = UyeBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: ilkHata(parsed.error) });

    const [klan] = await db
      .select({ id: identitySchema.clans.id })
      .from(identitySchema.clans)
      .where(eq(identitySchema.clans.id, id.data))
      .limit(1);
    if (!klan) return reply.code(404).send({ error: 'klan bulunamadı' });

    // Sonuç ayrıntılı dönüyor: hangi kimliklerin alınmadığı görünmezse
    // listenin yarısı eksik girip kimse fark etmiyor.
    return await uyeEkle(db, id.data, parsed.data.steamIds);
  });

  app.delete('/clans/:id/members', { preHandler: guard }, async (req, reply) => {
    const id = uuid.safeParse((req.params as { id: string }).id);
    if (!id.success) return reply.code(400).send({ error: 'geçersiz id' });

    const parsed = UyeBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: ilkHata(parsed.error) });

    const cikarilan = await uyeCikar(db, id.data, parsed.data.steamIds);
    return { cikarilan };
  });
}
