import type { AgentQuery } from '@altai/contracts';
import type { Db } from '@altai/db';
import { identitySchema, moderationSchema } from '@altai/db';
import { and, eq, isNull, or, sql } from 'drizzle-orm';

/**
 * Agent'ın sorabildiği soruların cevapları.
 *
 * Agent Postgres'e dokunmuyor (plan Bölüm 3) ama plugin'lerin bir kısmı
 * veri OKUMAK zorunda: SL ban denetimi oyuncunun etiketine, seed ödülü
 * oynama süresine bakıyor. Bu dosya o soruların tek cevap noktası.
 *
 * TASARIM SINIRI: sorgu türleri dar ve sabit. Genel bir "şu tabloyu oku"
 * ucu, agent'a veritabanı erişimi vermemenin bütün anlamını ortadan
 * kaldırırdı — oyun sunucusundaki bir süreç, kendisini ilgilendirmeyen
 * veriyi isteyememeli.
 */

export interface FlagYaniti {
  /** Oyuncu veritabanında bulundu mu? */
  bulundu: boolean;
  /** Aktif (kaldırılmamış) etiket adları. */
  flags: string[];
}

export interface PlaytimeYaniti {
  bulundu: boolean;
  toplamSaniye: number;
  oturum: number;
}

/** steamId/eosId -> players.id. İkisi de yoksa null. */
async function oyuncuId(
  db: Db,
  steamId: string | null | undefined,
  eosId: string | null | undefined,
): Promise<string | null> {
  const kosullar = [];
  if (steamId) kosullar.push(eq(identitySchema.players.steamId, steamId));
  // EOS küçük harfle saklanıyor; gelen değer büyük harfli olabiliyor.
  if (eosId) kosullar.push(eq(identitySchema.players.eosId, eosId.toLowerCase()));
  if (kosullar.length === 0) return null;

  const [row] = await db
    .select({ id: identitySchema.players.id })
    .from(identitySchema.players)
    .where(kosullar.length === 1 ? kosullar[0] : or(...kosullar))
    .limit(1);
  return row?.id ?? null;
}

export async function sorguyuCoz(db: Db, query: AgentQuery): Promise<unknown> {
  const id = await oyuncuId(db, query.steamId, query.eosId);

  switch (query.kind) {
    case 'player_flags': {
      // Oyuncu hiç kayıtlı değilse "etiketi yok" ile "bilmiyoruz" ayrı
      // şeyler: ilki bir cevap, ikincisi bir boşluk. Plugin ikisine farklı
      // davranabilmeli, o yüzden `bulundu` taşınıyor.
      if (!id) return { bulundu: false, flags: [] } satisfies FlagYaniti;

      const rows = await db
        .select({ name: moderationSchema.flags.name })
        .from(moderationSchema.flagAssignments)
        .innerJoin(
          moderationSchema.flags,
          eq(moderationSchema.flags.id, moderationSchema.flagAssignments.flagId),
        )
        .where(
          and(
            eq(moderationSchema.flagAssignments.playerId, id),
            isNull(moderationSchema.flagAssignments.removedAt),
          ),
        );

      return { bulundu: true, flags: rows.map((r) => r.name) } satisfies FlagYaniti;
    }

    case 'player_playtime': {
      if (!id) return { bulundu: false, toplamSaniye: 0, oturum: 0 } satisfies PlaytimeYaniti;

      const res = await db.execute<{ oturum: number; saniye: string }>(sql`
        select count(*)::int as oturum,
               coalesce(sum(extract(epoch from (coalesce(left_at, now()) - joined_at))), 0)::bigint as saniye
          from game_sessions
         where player_id = ${id}
      `);
      const r = (res as unknown as Record<string, unknown>[])[0] ?? {};
      return {
        bulundu: true,
        toplamSaniye: Number(r.saniye ?? 0),
        oturum: Number(r.oturum ?? 0),
      } satisfies PlaytimeYaniti;
    }
  }
}
