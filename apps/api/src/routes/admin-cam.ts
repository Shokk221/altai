import type { Db } from '@altai/db';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../lib/auth-guard.js';

/**
 * Yetkili kamerası kayıtları — plan Faz 6.
 *
 * Tabloyu doldurmak tek başına bir işe yaramıyordu: takibin bütün amacı
 * kimin ne kadar kamerada kaldığını GÖREBİLMEK. Kamera, başkasının
 * ekranını izleme yetkisi; kullanımının denetlenebilir olması gerekiyor.
 *
 * İzin `audit.read`, `player.view` DEĞİL: bu veri yetkililerin kendi
 * davranışıyla ilgili ve oyuncu profiline bakabilen herkese açık olmamalı.
 */

const UUID = /^[0-9a-f-]{36}$/i;

/** `days` parametresi. Yok/geçersiz = son 30 gün. */
function gunOku(ham: string | undefined): number {
  const n = Number(ham);
  if (!Number.isInteger(n) || n <= 0 || n > 365) return 30;
  return n;
}

export async function adminCamRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const guard = requireSession(opts.db, 'audit.read');

  /**
   * Son kamera oturumları — yeniden eskiye.
   *
   * Süre BURADA hesaplanıyor, kolonda tutulmuyor: `entered_at`/`left_at`
   * tek doğruluk kaynağı ve türetilmiş bir süre kolonu, reconciler bir
   * satırı sonradan kapattığında güncellenmeyi unutulacak ikinci bir yer
   * olurdu.
   *
   * Açık oturumlar da dönüyor (`leftAt: null`): "şu an kamerada kim var"
   * sorusunun cevabı ve gizlenmesi için bir sebep yok.
   */
  app.get<{ Querystring: { days?: string; limit?: string } }>(
    '/admin-cam',
    { preHandler: guard },
    async (req) => {
      const days = gunOku(req.query.days);
      const limitHam = Number(req.query.limit ?? 100);
      const limit = Number.isInteger(limitHam) ? Math.min(Math.max(limitHam, 1), 200) : 100;

      const res = await db.execute(sql`
        select l.id,
               l.player_id,
               l.entered_at,
               l.left_at,
               s.slug as server_slug,
               (select pn.name
                  from player_names pn
                 where pn.player_id = l.player_id
                 order by pn.last_seen desc nulls last
                 limit 1) as name,
               p.steam_id
          from admin_cam_logs l
          join players p on p.id = l.player_id
          left join servers s on s.id = l.server_id
         where l.entered_at >= now() - ${`${days} days`}::interval
         order by l.entered_at desc
         limit ${limit}
      `);

      return {
        days,
        oturumlar: (res as unknown as Record<string, unknown>[]).map((r) => satira(r)),
      };
    },
  );

  /**
   * Kamera kullanım özeti — yetkili başına toplam.
   *
   * Asıl denetim sorusu bu: "kim ne kadar kamerada kalıyor". Tek tek
   * oturumlara bakarak bu cevaba ulaşmak, yüzlerce satırı elle toplamak
   * demekti.
   *
   * Açık oturumlar toplama `now()`'a kadar sayılıyor; hâlâ süren bir
   * oturumu sıfır saymak, o an kamerada olan kişiyi listeden düşürürdü.
   */
  app.get<{ Querystring: { days?: string } }>(
    '/admin-cam/ozet',
    { preHandler: guard },
    async (req) => {
      const days = gunOku(req.query.days);

      const res = await db.execute(sql`
        select l.player_id,
               p.steam_id,
               (select pn.name
                  from player_names pn
                 where pn.player_id = l.player_id
                 order by pn.last_seen desc nulls last
                 limit 1) as name,
               count(*)::int as oturum,
               coalesce(sum(extract(epoch from (coalesce(l.left_at, now()) - l.entered_at))), 0)::bigint as saniye,
               max(l.entered_at) as son_giris,
               count(*) filter (where l.left_at is null)::int as acik
          from admin_cam_logs l
          join players p on p.id = l.player_id
         where l.entered_at >= now() - ${`${days} days`}::interval
         group by l.player_id, p.steam_id
         order by saniye desc
         limit 100
      `);

      return {
        days,
        yetkililer: (res as unknown as Record<string, unknown>[]).map((r) => ({
          playerId: String(r.player_id),
          steamId: metin(r.steam_id),
          name: metin(r.name),
          oturum: Number(r.oturum ?? 0),
          toplamSaniye: Number(r.saniye ?? 0),
          sonGiris: r.son_giris ? new Date(String(r.son_giris)).toISOString() : null,
          acik: Number(r.acik ?? 0),
        })),
      };
    },
  );

  /** Tek oyuncunun kamera oturumları — profil sayfası için. */
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/players/:id/admin-cam',
    { preHandler: guard },
    async (req, reply) => {
      if (!UUID.test(req.params.id)) {
        return reply.code(400).send({ error: 'gecersiz_oyuncu_id' });
      }
      const limitHam = Number(req.query.limit ?? 50);
      const limit = Number.isInteger(limitHam) ? Math.min(Math.max(limitHam, 1), 200) : 50;

      const res = await db.execute(sql`
        select l.id, l.player_id, l.entered_at, l.left_at, s.slug as server_slug,
               null as name, null as steam_id
          from admin_cam_logs l
          left join servers s on s.id = l.server_id
         where l.player_id = ${req.params.id}
         order by l.entered_at desc
         limit ${limit}
      `);

      return { oturumlar: (res as unknown as Record<string, unknown>[]).map((r) => satira(r)) };
    },
  );
}

function metin(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

/** Ham satırı cevaba çevirir; süreyi burada hesaplar. */
function satira(r: Record<string, unknown>) {
  const girdi = new Date(String(r.entered_at));
  const cikti = r.left_at ? new Date(String(r.left_at)) : null;
  return {
    id: String(r.id),
    playerId: String(r.player_id),
    name: metin(r.name),
    steamId: metin(r.steam_id),
    serverSlug: metin(r.server_slug),
    enteredAt: girdi.toISOString(),
    leftAt: cikti ? cikti.toISOString() : null,
    // Açık oturumda süre `now()`'a kadar: "şu an 12 dakikadır kamerada"
    // bilgisi, boş bir alandan çok daha kullanışlı.
    saniye: Math.max(0, Math.round(((cikti ?? new Date()).getTime() - girdi.getTime()) / 1000)),
    acik: cikti === null,
  };
}
