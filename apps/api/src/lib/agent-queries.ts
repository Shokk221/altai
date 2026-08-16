import type { AgentQuery } from '@altai/contracts';
import type { Db } from '@altai/db';
import { identitySchema, matchesSchema, moderationSchema } from '@altai/db';
import { and, desc, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';

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

/**
 * Steam seviyesi ne zaman okundu, yeniden okumaya gerek var mı?
 *
 * Gizli profillere AYRI ve daha kısa bir süre uygulanıyor: kullanıcı
 * profilini açmış olabilir ve 30 gün beklemek gereksiz. Buna karşılık
 * başarıyla okunmuş bir seviye uzun süre geçerli — Steam seviyesi yavaş
 * değişen bir veri.
 */
async function steamTazeligi(
  db: Db,
  query: Extract<AgentQuery, { kind: 'steam_level_freshness' }>,
): Promise<SteamTazelikYaniti> {
  const id = await oyuncuId(db, query.steamId, null);
  if (!id) return { bulundu: false, taze: false };

  const [satir] = await db
    .select({
      checkedAt: identitySchema.steamProfiles.checkedAt,
      private: identitySchema.steamProfiles.private,
    })
    .from(identitySchema.steamProfiles)
    .where(eq(identitySchema.steamProfiles.playerId, id))
    .limit(1);

  if (!satir) return { bulundu: false, taze: false };

  const gun = satir.private ? query.privateMaxAgeDays : query.maxAgeDays;
  const yas = Date.now() - satir.checkedAt.getTime();
  return { bulundu: true, taze: yas < gun * 24 * 60 * 60 * 1000 };
}

export interface OyuncuKlani {
  steamId: string | null;
  eosId: string | null;
  clan: string;
  tag: string | null;
}

/**
 * Verilen kimliklerin klanları — tek turda.
 *
 * Takım dengeleyici bunu karıştırma planı kurarken çağırıyor: klan
 * üyelerini aynı tarafta tutmak için önce kimin hangi klanda olduğunu
 * bilmesi gerekiyor. Oyuncu başına sormak 80 tur demekti.
 *
 * Yalnızca AKTİF üyelikler. Ayrılmış üye kaydı duruyor (tarihçe) ama
 * bugünün takım kararına girmemeli.
 */
async function oyuncuKlanlari(db: Db, ids: string[]): Promise<OyuncuKlani[]> {
  const steamler = ids.filter((k) => /^7656119\d{10}$/.test(k));
  const eoslar = ids.filter((k) => /^[0-9a-f]{32}$/i.test(k)).map((k) => k.toLowerCase());
  if (steamler.length === 0 && eoslar.length === 0) return [];

  const kimlikKosulu = [];
  if (steamler.length > 0) kimlikKosulu.push(inArray(identitySchema.players.steamId, steamler));
  if (eoslar.length > 0) kimlikKosulu.push(inArray(identitySchema.players.eosId, eoslar));

  const rows = await db
    .select({
      steamId: identitySchema.players.steamId,
      eosId: identitySchema.players.eosId,
      clan: identitySchema.clans.name,
      tag: identitySchema.clans.tag,
    })
    .from(identitySchema.clanMembers)
    .innerJoin(identitySchema.clans, eq(identitySchema.clans.id, identitySchema.clanMembers.clanId))
    .innerJoin(
      identitySchema.players,
      eq(identitySchema.players.id, identitySchema.clanMembers.playerId),
    )
    .where(and(isNull(identitySchema.clanMembers.removedAt), or(...kimlikKosulu)));

  return rows;
}

export interface MacOzeti {
  winnerTeam: number | null;
  winnerTickets: number | null;
  loserTickets: number | null;
}

/**
 * Sunucunun son maçları — yeniden eskiye.
 *
 * Eski `teambalancer` galibiyet serisini kendi SQLite dosyasında
 * tutuyordu, çünkü SquadJS'in maç geçmişi yoktu. Bizde `rounds` tablosu
 * zaten var ve seri ondan TÜRETİLİYOR: ikinci bir doğruluk kaynağı
 * tutmak, agent yeniden başladığında ya da iki sunucu aynı veriyi
 * yazdığında ayrışacak bir sayaç demekti.
 */
async function sonMaclar(db: Db, serverId: string | undefined, limit: number): Promise<MacOzeti[]> {
  if (!serverId) return [];
  const rows = await db
    .select({
      winnerTeam: matchesSchema.rounds.winnerTeam,
      team1Tickets: matchesSchema.rounds.team1Tickets,
      team2Tickets: matchesSchema.rounds.team2Tickets,
    })
    .from(matchesSchema.rounds)
    .where(
      and(eq(matchesSchema.rounds.serverId, serverId), isNotNull(matchesSchema.rounds.endedAt)),
    )
    .orderBy(desc(matchesSchema.rounds.endedAt))
    .limit(limit);

  return rows.map((r) => {
    const kazanan = r.winnerTeam ?? null;
    const kazananBilet = kazanan === 1 ? r.team1Tickets : kazanan === 2 ? r.team2Tickets : null;
    const kaybedenBilet = kazanan === 1 ? r.team2Tickets : kazanan === 2 ? r.team1Tickets : null;
    return {
      winnerTeam: kazanan,
      winnerTickets: kazananBilet ?? null,
      loserTickets: kaybedenBilet ?? null,
    };
  });
}

export interface EtiketliOyuncu {
  steamId: string | null;
  eosId: string | null;
  flags: string[];
}

/**
 * Verilen kimlikler arasında AKTİF etiketi olanlar.
 *
 * Tek turda cevap veriyor: admin kameraya geçtiğinde sunucudaki herkes
 * için ayrı sorgu atmak, cevabı saniyelerce geciktirirdi.
 *
 * Etiketi OLMAYAN oyuncular cevapta hiç yer almıyor — çağıran taraf
 * zaten kimleri sorduğunu biliyor ve boş satır göndermek, dolu bir
 * sunucuda cevabın çoğunu anlamsız veriyle şişirirdi.
 */
async function etiketliOyuncular(
  db: Db,
  query: Extract<AgentQuery, { kind: 'flagged_players' }>,
): Promise<EtiketliOyuncu[]> {
  // Kimlikler karışık gelebiliyor (steam ya da eos). EOS küçük harfle
  // saklandığı için ikisi ayrı ayrı karşılaştırılıyor.
  const steamler = query.ids.filter((k) => /^7656119\d{10}$/.test(k));
  const eoslar = query.ids.filter((k) => /^[0-9a-f]{32}$/i.test(k)).map((k) => k.toLowerCase());
  if (steamler.length === 0 && eoslar.length === 0) return [];

  const kimlikKosulu = [];
  if (steamler.length > 0) kimlikKosulu.push(inArray(identitySchema.players.steamId, steamler));
  if (eoslar.length > 0) kimlikKosulu.push(inArray(identitySchema.players.eosId, eoslar));

  const rows = await db
    .select({
      steamId: identitySchema.players.steamId,
      eosId: identitySchema.players.eosId,
      flag: moderationSchema.flags.name,
    })
    .from(moderationSchema.flagAssignments)
    .innerJoin(
      moderationSchema.flags,
      eq(moderationSchema.flags.id, moderationSchema.flagAssignments.flagId),
    )
    .innerJoin(
      identitySchema.players,
      eq(identitySchema.players.id, moderationSchema.flagAssignments.playerId),
    )
    .where(and(isNull(moderationSchema.flagAssignments.removedAt), or(...kimlikKosulu)));

  // Ad süzmesi SQL'de değil burada: karşılaştırma harf duyarsız ve
  // Türkçe'ye özgü (İ/ı), veritabanının collation'ına bırakılamaz.
  const aranan = new Set(query.flagNames.map((f) => f.toLocaleUpperCase('tr-TR')));

  const sonuc = new Map<string, EtiketliOyuncu>();
  for (const r of rows) {
    if (aranan.size > 0 && !aranan.has(r.flag.toLocaleUpperCase('tr-TR'))) continue;
    const anahtar = r.steamId ?? r.eosId ?? '';
    if (!anahtar) continue;
    const mevcut = sonuc.get(anahtar);
    if (mevcut) mevcut.flags.push(r.flag);
    else sonuc.set(anahtar, { steamId: r.steamId, eosId: r.eosId, flags: [r.flag] });
  }

  return [...sonuc.values()];
}

export interface SteamTazelikYaniti {
  /** Bu oyuncu için hiç Steam kaydı var mı? */
  bulundu: boolean;
  /** Kayıt hâlâ taze mi — taze ise agent Steam'e istek atmıyor. */
  taze: boolean;
}

export async function sorguyuCoz(db: Db, query: AgentQuery, serverId?: string): Promise<unknown> {
  // Steam tazeliği kendi kimlik çözümlemesini yapıyor: yalnızca SteamID
  // taşıyor ve EOS alanı yok.
  if (query.kind === 'steam_level_freshness') {
    return steamTazeligi(db, query);
  }

  if (query.kind === 'flagged_players') {
    return etiketliOyuncular(db, query);
  }

  if (query.kind === 'recent_rounds') {
    return sonMaclar(db, serverId, query.limit);
  }

  if (query.kind === 'player_clans') {
    return oyuncuKlanlari(db, query.ids);
  }

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
