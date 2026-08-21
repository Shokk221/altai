import type { Db } from '@altai/db';
import {
  SAVAS_DURUMLARI,
  communitySchema,
  durumDegistir,
  identitySchema,
  kadroyaEkle,
  kadroyuKilitle,
} from '@altai/db';
import { asc, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../lib/auth-guard.js';

/**
 * Klan savaşları ve lobi — panel yüzeyi (plan Faz 5).
 *
 * Eski `clanwarenforcer` izinli oyuncu listesini plugin config'inde
 * tutuyordu; her maç öncesi dosya düzenleyip agent'ı yeniden başlatmak
 * gerekiyordu. Buradan yönetilen liste plugin'e sorguyla gidiyor.
 */

const uuid = z.string().uuid();

const SavasBody = z.object({
  serverId: uuid,
  name: z.string().trim().min(1).max(120),
  scheduledAt: z.string().datetime().nullish(),
});

const TakimBody = z.object({
  clanId: uuid,
  side: z.number().int().min(1).max(2),
});

const KadroBody = z.object({
  clanId: uuid,
  /** Serbest metin: satır sonu, virgül, boşluk ya da profil bağlantısı. */
  steamIds: z.string().min(1).max(100_000),
});

const DurumBody = z.object({
  status: z.enum(SAVAS_DURUMLARI),
});

function ilkHata(err: z.ZodError): string {
  const i = err.issues[0];
  if (!i) return 'geçersiz girdi';
  return i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message;
}

export async function clanWarRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  // Klan savaşı sunucuya kimin girebileceğini belirliyor — sunucu
  // kontrolü yetkisi, klan yönetimiyle aynı seviye.
  const guard = requireSession(db, 'clan.manage');

  app.get('/clan-wars', { preHandler: guard }, async () => {
    const savaslar = await db
      .select()
      .from(communitySchema.clanWars)
      .orderBy(desc(communitySchema.clanWars.createdAt))
      .limit(100);
    return { wars: savaslar };
  });

  app.post('/clan-wars', { preHandler: guard }, async (req, reply) => {
    const parsed = SavasBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: ilkHata(parsed.error) });

    const [olusan] = await db
      .insert(communitySchema.clanWars)
      .values({
        serverId: parsed.data.serverId,
        name: parsed.data.name,
        scheduledAt: parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : null,
        status: 'planned',
      })
      .returning();
    return reply.code(201).send({ war: olusan });
  });

  /** Savaş + takımlar + kadro. */
  app.get<{ Params: { id: string } }>(
    '/clan-wars/:id',
    { preHandler: guard },
    async (req, reply) => {
      if (!uuid.safeParse(req.params.id).success) {
        return reply.code(400).send({ error: 'gecersiz_savas_id' });
      }
      const [savas] = await db
        .select()
        .from(communitySchema.clanWars)
        .where(eq(communitySchema.clanWars.id, req.params.id))
        .limit(1);
      if (!savas) return reply.code(404).send({ error: 'savas_bulunamadi' });

      const takimlar = await db
        .select({
          id: communitySchema.clanWarTeams.id,
          clanId: communitySchema.clanWarTeams.clanId,
          side: communitySchema.clanWarTeams.side,
          clanName: identitySchema.clans.name,
          clanTag: identitySchema.clans.tag,
        })
        .from(communitySchema.clanWarTeams)
        .innerJoin(
          identitySchema.clans,
          eq(identitySchema.clans.id, communitySchema.clanWarTeams.clanId),
        )
        .where(eq(communitySchema.clanWarTeams.warId, req.params.id))
        .orderBy(asc(communitySchema.clanWarTeams.side));

      const kadro = await db
        .select({
          playerId: communitySchema.clanWarRoster.playerId,
          clanId: communitySchema.clanWarRoster.clanId,
          steamId: identitySchema.players.steamId,
        })
        .from(communitySchema.clanWarRoster)
        .innerJoin(
          identitySchema.players,
          eq(identitySchema.players.id, communitySchema.clanWarRoster.playerId),
        )
        .where(eq(communitySchema.clanWarRoster.warId, req.params.id));

      return { war: savas, takimlar, kadro };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/clan-wars/:id/takimlar',
    { preHandler: guard },
    async (req, reply) => {
      if (!uuid.safeParse(req.params.id).success) {
        return reply.code(400).send({ error: 'gecersiz_savas_id' });
      }
      const parsed = TakimBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: ilkHata(parsed.error) });

      const [olusan] = await db
        .insert(communitySchema.clanWarTeams)
        .values({ warId: req.params.id, clanId: parsed.data.clanId, side: parsed.data.side })
        .onConflictDoNothing()
        .returning();
      // Zaten ekliyse 409: sessizce başarılı dönmek, tarafını
      // değiştirdiğini sanan kişiyi yanıltırdı.
      if (!olusan) return reply.code(409).send({ error: 'klan_zaten_ekli' });
      return reply.code(201).send({ takim: olusan });
    },
  );

  /**
   * Kadroya SteamID listesiyle oyuncu ekler.
   *
   * Sonuç AYRINTILI dönüyor: kaç kişi eklendi, kaçı zaten kadrodaydı,
   * kaçı klan üyesi değil, hangileri okunamadı. Yalnızca "eklendi" demek,
   * 20 kişilik bir listenin 3'ünün sessizce düşmesini görünmez kılardı ve
   * o üç kişi maç gecesi sunucuya giremezdi.
   */
  app.post<{ Params: { id: string } }>(
    '/clan-wars/:id/kadro',
    { preHandler: guard },
    async (req, reply) => {
      if (!uuid.safeParse(req.params.id).success) {
        return reply.code(400).send({ error: 'gecersiz_savas_id' });
      }
      const parsed = KadroBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: ilkHata(parsed.error) });

      const sonuc = await kadroyaEkle(db, req.params.id, parsed.data.clanId, parsed.data.steamIds);
      if (sonuc.kilitli) return reply.code(409).send({ error: 'kadro_kilitli' });
      return sonuc;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/clan-wars/:id/kilitle',
    { preHandler: guard },
    async (req, reply) => {
      if (!uuid.safeParse(req.params.id).success) {
        return reply.code(400).send({ error: 'gecersiz_savas_id' });
      }
      const ok = await kadroyuKilitle(db, req.params.id);
      if (!ok) return reply.code(409).send({ error: 'zaten_kilitli' });
      return { ok: true };
    },
  );

  /**
   * Durum değişikliği.
   *
   * `live`'a geçiş KADRO BOŞKEN reddediliyor (lib tarafında): boş kadrolu
   * bir savaşta yaptırım sunucudaki herkesi atardı ve "başlat"a basan
   * kişinin beklediği şey bu değil.
   */
  app.post<{ Params: { id: string } }>(
    '/clan-wars/:id/durum',
    { preHandler: guard },
    async (req, reply) => {
      if (!uuid.safeParse(req.params.id).success) {
        return reply.code(400).send({ error: 'gecersiz_savas_id' });
      }
      const parsed = DurumBody.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: ilkHata(parsed.error) });

      const sonuc = await durumDegistir(db, req.params.id, parsed.data.status);
      if (!sonuc.ok) {
        return reply
          .code(sonuc.sebep === 'kadro_bos' ? 409 : 404)
          .send({ error: sonuc.sebep ?? 'savas_bulunamadi' });
      }
      return { ok: true };
    },
  );
}
