import type { Db } from '@altai/db';
import { activitySchema, identitySchema } from '@altai/db';
import { and, desc, eq, ilike, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../lib/auth-guard.js';

/**
 * Sistem günlüğü okuma uçları.
 *
 * Sayfalama imleç ile, sayfa numarasıyla değil: günlük saniyede satır
 * alıyor, "sayfa 2" istendiğinde araya yeni kayıtlar girmiş oluyor ve
 * offset ile bakan kişi bazı satırları hiç görmüyor. İmleç (at, id) çifti
 * bu kaymayı tamamen yok ediyor.
 */

const VARSAYILAN_LIMIT = 100;
const TAVAN_LIMIT = 300;

interface Sorgu {
  before?: string;
  beforeId?: string;
  limit?: string;
  kategori?: string;
  aktor?: string;
  eylem?: string;
  hedef?: string;
  q?: string;
}

export async function activityRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const guard = requireSession(db, 'audit.read');

  app.get<{ Querystring: Sorgu }>('/activity', { preHandler: guard }, async (req, reply) => {
    const s = req.query;

    const limit = Math.min(Number(s.limit) || VARSAYILAN_LIMIT, TAVAN_LIMIT);

    const kosullar = [];

    // İmleç: aynı milisaniyede birden fazla satır olabildiği için id
    // ikinci sıralama anahtarı — yoksa sınırda kalan satırlar ya
    // tekrarlanır ya atlanır.
    if (s.before) {
      const t = new Date(s.before);
      if (Number.isNaN(t.getTime())) {
        return reply.code(400).send({ error: 'gecersiz_imlec' });
      }
      kosullar.push(
        s.beforeId
          ? or(
              lt(activitySchema.activityLog.at, t),
              and(
                eq(activitySchema.activityLog.at, t),
                lt(activitySchema.activityLog.id, s.beforeId),
              ),
            )
          : lt(activitySchema.activityLog.at, t),
      );
    }

    if (
      s.kategori &&
      (activitySchema.ACTIVITY_CATEGORIES as readonly string[]).includes(s.kategori)
    ) {
      kosullar.push(sql`${activitySchema.activityLog.category} = ${s.kategori}`);
    }
    if (s.aktor) {
      kosullar.push(eq(activitySchema.activityLog.actorUserId, s.aktor));
    }
    if (s.hedef) {
      kosullar.push(eq(activitySchema.activityLog.targetId, s.hedef));
    }
    if (s.eylem) {
      // Önek eşleşmesi: 'ban' yazan kişi ban.create ve ban.revoke'u birlikte
      // görmek istiyor.
      kosullar.push(ilike(activitySchema.activityLog.action, `${s.eylem}%`));
    }
    if (s.q && s.q.trim().length > 0) {
      const kalip = `%${s.q.trim()}%`;
      kosullar.push(
        or(
          ilike(activitySchema.activityLog.actorLabel, kalip),
          ilike(activitySchema.activityLog.path, kalip),
          ilike(activitySchema.activityLog.targetLabel, kalip),
          ilike(activitySchema.activityLog.action, kalip),
        ),
      );
    }

    const satirlar = await db
      .select({
        id: activitySchema.activityLog.id,
        at: activitySchema.activityLog.at,
        actorType: activitySchema.activityLog.actorType,
        actorUserId: activitySchema.activityLog.actorUserId,
        actorLabel: activitySchema.activityLog.actorLabel,
        action: activitySchema.activityLog.action,
        category: activitySchema.activityLog.category,
        targetType: activitySchema.activityLog.targetType,
        targetId: activitySchema.activityLog.targetId,
        targetLabel: activitySchema.activityLog.targetLabel,
        method: activitySchema.activityLog.method,
        path: activitySchema.activityLog.path,
        route: activitySchema.activityLog.route,
        statusCode: activitySchema.activityLog.statusCode,
        durationMs: activitySchema.activityLog.durationMs,
        ip: activitySchema.activityLog.ip,
        payload: activitySchema.activityLog.payload,
        requestId: activitySchema.activityLog.requestId,
      })
      .from(activitySchema.activityLog)
      .where(kosullar.length > 0 ? and(...kosullar) : undefined)
      .orderBy(desc(activitySchema.activityLog.at), desc(activitySchema.activityLog.id))
      .limit(limit + 1);

    // limit+1 çekip fazlasını atıyoruz: "daha var mı" sorusunun ayrı bir
    // COUNT sorgusu olmadan cevabı.
    const dahaVar = satirlar.length > limit;
    const sayfa = dahaVar ? satirlar.slice(0, limit) : satirlar;
    const son = sayfa.at(-1);

    return {
      satirlar: sayfa,
      sonrakiImlec: dahaVar && son ? { before: son.at.toISOString(), beforeId: son.id } : null,
    };
  });

  /**
   * Filtre kutusunu doldurmak için: günlükte gerçekten kaydı olan
   * kullanıcılar. Tüm kullanıcı listesi değil — hiç işlem yapmamış 3.000
   * Discord üyesini filtre menüsünde göstermenin anlamı yok.
   */
  app.get('/activity/aktorler', { preHandler: guard }, async () => {
    const rows = await db
      .select({
        id: identitySchema.users.id,
        ad: identitySchema.users.discordUsername,
        sonIslem: sql<string>`max(${activitySchema.activityLog.at})`,
        adet: sql<number>`count(*)::int`,
      })
      .from(activitySchema.activityLog)
      .innerJoin(
        identitySchema.users,
        eq(identitySchema.users.id, activitySchema.activityLog.actorUserId),
      )
      .groupBy(identitySchema.users.id, identitySchema.users.discordUsername)
      .orderBy(desc(sql`max(${activitySchema.activityLog.at})`))
      .limit(100);
    return { aktorler: rows };
  });

  /**
   * Son 24 saatin kırılımı — ekranın üstündeki sayaçlar.
   * Tek sorguda: dört ayrı COUNT dört gidiş dönüş demekti.
   */
  app.get('/activity/ozet', { preHandler: guard }, async () => {
    const rows = await db
      .select({
        kategori: activitySchema.activityLog.category,
        adet: sql<number>`count(*)::int`,
      })
      .from(activitySchema.activityLog)
      .where(sql`${activitySchema.activityLog.at} > now() - interval '24 hours'`)
      .groupBy(activitySchema.activityLog.category);
    return { son24Saat: rows };
  });
}
