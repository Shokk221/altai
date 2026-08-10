import type { Db } from '@altai/db';
import { identitySchema, moderationSchema } from '@altai/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { agentBagliMi, komutGonder } from '../lib/agent-command-bus.js';
import { writeAudit } from '../lib/audit.js';
import { requireSession } from '../lib/auth-guard.js';

/**
 * Canlı ekrandan hızlı eylemler.
 *
 * Kontrol panelinde elimizde oyuncunun SteamID'si var, veritabanı UUID'si
 * değil — oyuncu listesi RCON'dan geliyor ve orada bizim kimliğimiz yok.
 * Moderasyon uçları ise UUID istiyor. Buradaki uçlar SteamID ile çalışıyor
 * ve UUID'yi kendileri çözüyor.
 *
 * Oyuncu veritabanında YOKSA eylem yine yapılıyor: RCON kimliği tanıyor,
 * bizim onu daha önce görmüş olmamız şart değil. Bu durumda denetim kaydı
 * hedefsiz yazılıyor ve SteamID yükte duruyor.
 */

const Govde = z.object({
  steamId: z.string().regex(/^7656119\d{10}$/, 'geçerli bir SteamID64 olmalı'),
  /** Kick sebebi ya da uyarı metni; oyuncuya gösteriliyor. */
  mesaj: z.string().trim().min(1).max(300),
});

function ilkHata(err: z.ZodError): string {
  const i = err.issues[0];
  if (!i) return 'geçersiz girdi';
  return i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message;
}

export async function liveActionRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  async function oyuncuBul(steamId: string) {
    const [p] = await db
      .select({ id: identitySchema.players.id, eosId: identitySchema.players.eosId })
      .from(identitySchema.players)
      .where(eq(identitySchema.players.steamId, steamId))
      .limit(1);
    return p ?? null;
  }

  /** Sunucudan at. Kalıcı kayıt bırakmaz — ban ayrı bir eylem. */
  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/live/:slug/kick',
    { preHandler: requireSession(db, 'player.kick') },
    async (req, reply) => {
      const parsed = Govde.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'gecersiz_girdi', detay: ilkHata(parsed.error) });
      }
      const slug = req.params.slug;
      if (!agentBagliMi(slug)) return reply.code(503).send({ error: 'agent_bagli_degil' });

      const oyuncu = await oyuncuBul(parsed.data.steamId);
      const actor = req.authSession;

      const sonuc = await komutGonder(
        slug,
        'kick',
        { steamId: parsed.data.steamId, eosId: oyuncu?.eosId ?? null, reason: parsed.data.mesaj },
        actor?.id ?? 'panel',
      );

      await db.transaction(async (tx) => {
        await writeAudit(tx, {
          actorUserId: actor?.id ?? null,
          actorLabel: actor?.discordUsername ?? null,
          requestId: String(req.id),
          action: 'player.kick',
          targetType: 'player',
          targetId: oyuncu?.id ?? null,
          payload: {
            steamId: parsed.data.steamId,
            sebep: parsed.data.mesaj,
            sunucu: slug,
            sonuc: sonuc.durum,
          },
        });
      });

      if (sonuc.durum !== 'ok') {
        return reply.code(502).send({ error: 'komut_basarisiz', detay: sonuc.durum });
      }
      return { ok: true };
    },
  );

  /** Oyun içinde uyarı göster. Kalıcı kayıt da bırakır (oyuncu biliniyorsa). */
  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/live/:slug/warn',
    { preHandler: requireSession(db, 'player.warn') },
    async (req, reply) => {
      const parsed = Govde.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'gecersiz_girdi', detay: ilkHata(parsed.error) });
      }
      const slug = req.params.slug;
      if (!agentBagliMi(slug)) return reply.code(503).send({ error: 'agent_bagli_degil' });

      const oyuncu = await oyuncuBul(parsed.data.steamId);
      const actor = req.authSession;

      const sonuc = await komutGonder(
        slug,
        'warn',
        { steamId: parsed.data.steamId, eosId: oyuncu?.eosId ?? null, message: parsed.data.mesaj },
        actor?.id ?? 'panel',
      );

      await db.transaction(async (tx) => {
        // Uyarı kalıcı kayıt: profilde görünmeli, yoksa "bu adama daha önce
        // söylendi mi" sorusu cevapsız kalıyor.
        if (oyuncu) {
          await tx.insert(moderationSchema.playerRecords).values({
            playerId: oyuncu.id,
            kind: 'warning',
            body: parsed.data.mesaj,
            deliveredAt: sonuc.durum === 'ok' ? new Date() : null,
            authorUserId: actor?.id ?? null,
            authorName: actor?.discordUsername ?? null,
            source: 'altai',
          });
        }
        await writeAudit(tx, {
          actorUserId: actor?.id ?? null,
          actorLabel: actor?.discordUsername ?? null,
          requestId: String(req.id),
          action: 'player.warn',
          targetType: 'player',
          targetId: oyuncu?.id ?? null,
          payload: {
            steamId: parsed.data.steamId,
            mesaj: parsed.data.mesaj,
            sunucu: slug,
            sonuc: sonuc.durum,
          },
        });
      });

      if (sonuc.durum !== 'ok') {
        return reply.code(502).send({ error: 'komut_basarisiz', detay: sonuc.durum });
      }
      return { ok: true, kayit: Boolean(oyuncu) };
    },
  );
}
