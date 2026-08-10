import { chatSchema, identitySchema, moderationSchema } from '@altai/db';
import type { Db } from '@altai/db';
import { and, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { requireSession } from '../lib/auth-guard.js';
import { aktifBanKosulu, banAktifMi } from '../lib/ban-active.js';

/**
 * Oyuncu arama ve profil — plan Bölüm 5 ("Oyuncu arama: pg_trgm ile kısmi
 * isim / SteamID / EOS ID araması").
 *
 * Aramanın zor yanı isim geçmişi: bir oyuncu 857.961 isim kaydının içinde
 * bugün kullanmadığı bir isimle aranabiliyor. Bu yüzden arama player_names
 * üzerinde yapılıp oyuncuya toplanıyor, sonuçta da eşleşen ismin kendisi
 * gösteriliyor ("bu oyuncu eskiden X adıyla oynuyordu").
 */

const SEARCH_LIMIT = 25;
const MIN_QUERY = 2;

export async function playerRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const guard = requireSession(opts.db, 'player.view');

  app.get<{ Querystring: { q?: string } }>(
    '/players/search',
    { preHandler: guard },
    async (req, reply) => {
      const q = (req.query.q ?? '').trim();
      if (q.length < MIN_QUERY) {
        return reply.code(400).send({ error: 'query_too_short', minLength: MIN_QUERY });
      }

      // Tam kimlik araması: kullanıcı SteamID/EOS yapıştırdıysa trigram'a
      // hiç gitmeden doğrudan bulunur (hem hızlı hem kesin).
      const looksLikeId = /^(7656119\d{10}|[0-9a-f]{32})$/i.test(q);
      if (looksLikeId) {
        const rows = await db
          .select({
            id: identitySchema.players.id,
            steamId: identitySchema.players.steamId,
            eosId: identitySchema.players.eosId,
          })
          .from(identitySchema.players)
          .where(
            or(
              eq(identitySchema.players.steamId, q),
              eq(identitySchema.players.eosId, q.toLowerCase()),
            ),
          )
          .limit(1);
        return { query: q, mode: 'identity', results: await decorate(db, rows) };
      }

      // İsim araması: pg_trgm benzerliği. `%` operatörü GIN indeksini
      // kullanıyor; similarity() ile sıralayıp en yakınları veriyoruz.
      const matches = await db.execute<{
        player_id: string;
        steam_id: string | null;
        eos_id: string | null;
        matched_name: string;
        score: number;
      }>(sql`
        select distinct on (p.id)
               p.id  as player_id,
               p.steam_id,
               p.eos_id,
               pn.name as matched_name,
               similarity(pn.name, ${q}) as score
        from player_names pn
        join players p on p.id = pn.player_id
        where pn.name % ${q}
        order by p.id, score desc
        limit ${SEARCH_LIMIT * 4}
      `);

      const rows = [...(matches as unknown as Array<Record<string, unknown>>)]
        .map((r) => ({
          id: String(r.player_id),
          steamId: (r.steam_id as string | null) ?? null,
          eosId: (r.eos_id as string | null) ?? null,
          matchedName: String(r.matched_name),
          score: Number(r.score),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, SEARCH_LIMIT);

      return { query: q, mode: 'name', results: await decorate(db, rows) };
    },
  );

  /** Atanabilir etiketler. Profildeki seçici bunu kullanıyor. */
  app.get('/flags', { preHandler: guard }, async () => {
    const rows = await db
      .select({
        id: moderationSchema.flags.id,
        name: moderationSchema.flags.name,
        description: moderationSchema.flags.description,
        color: moderationSchema.flags.color,
      })
      .from(moderationSchema.flags)
      .orderBy(moderationSchema.flags.name);
    return { flags: rows };
  });

  /**
   * Birlikte oynadıkları — plan Bölüm 4.1 "coplay geçmişi".
   *
   * Oturumların ZAMAN ÇAKIŞMASINDAN hesaplanıyor: aynı sunucuda, aynı anda
   * içeride olmuş iki oyuncu. Alt sınır konuyor çünkü bir haritada yan yana
   * düşmek anlamlı değil; birlikte geçirilen toplam süre asıl sinyal.
   *
   * Sorgu ağır (417 bin oturum) — bu yüzden AYRI uç, profille birlikte
   * yüklenmiyor. Admin ihtiyaç duyduğunda açıyor.
   */
  app.get<{ Params: { id: string } }>(
    '/players/:id/coplay',
    { preHandler: guard },
    async (req, reply) => {
      const id = req.params.id;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return reply.code(400).send({ error: 'gecersiz_oyuncu_id' });
      }

      // Yalnızca son 90 gün: "kimlerle takılıyor" güncel bir soru ve tüm
      // tarihçeyi taramak sorguyu dakikalara çıkarırdı.
      const satirlar = await db.execute<{
        player_id: string;
        name: string | null;
        steam_id: string | null;
        birlikte_saniye: number;
        oturum: number;
      }>(sql`
        with benim as (
          select server_id, joined_at, coalesce(left_at, now()) as left_at
            from game_sessions
           where player_id = ${id}
             and joined_at > now() - interval '90 days'
        )
        select o.player_id,
               max(pn.name) as name,
               max(p.steam_id) as steam_id,
               sum(extract(epoch from (
                 least(o.left_at_c, b.left_at) - greatest(o.joined_at, b.joined_at)
               )))::bigint as birlikte_saniye,
               count(*)::int as oturum
          from benim b
          join lateral (
            select g.player_id, g.joined_at, coalesce(g.left_at, now()) as left_at_c
              from game_sessions g
             where g.server_id = b.server_id
               and g.player_id <> ${id}
               -- PENCERE. Bu satır olmadan sorgu 417 bin oturumu tam
               -- tarıyordu (564 ms): "benden önce başlamış" koşulu
               -- tarihsel olarak neredeyse her satırı kapsıyor ve indeks
               -- seçici olamıyor. Bir oturum sonsuza kadar sürmez;
               -- veritabanındaki en uzunu 55 saat, üç gün rahat bir üst
               -- sınır. Pencereyle 15 ms.
               and g.joined_at > b.joined_at - interval '3 days'
               and g.joined_at < b.left_at
               and coalesce(g.left_at, now()) > b.joined_at
          ) o on true
          join players p on p.id = o.player_id
          left join player_names pn on pn.player_id = o.player_id
         group by o.player_id
        having sum(extract(epoch from (
                 least(o.left_at_c, b.left_at) - greatest(o.joined_at, b.joined_at)
               ))) > 3600
         order by birlikte_saniye desc
         limit 25
      `);

      const liste = (satirlar as unknown as Record<string, unknown>[]).map((r) => ({
        playerId: String(r.player_id),
        name: (r.name as string | null) ?? '(isim yok)',
        steamId: (r.steam_id as string | null) ?? null,
        birlikteSaniye: Number(r.birlikte_saniye ?? 0),
        oturum: Number(r.oturum ?? 0),
      }));
      return { coplay: liste };
    },
  );

  /**
   * Oyuncunun sohbeti — sayfalı ve aranabilir.
   *
   * Profil ucu yalnızca son 200 mesajı veriyor; 224 oyuncunun bundan
   * fazlası var ve bunlar tam da moderasyonda bakılan kişiler (en çok
   * konuşanda 3.901 mesaj). Hepsini profile koymak her açılışta yüz
   * kilobaytlarca veri taşımak olurdu.
   *
   * `before` imleç: son görülen mesajın zamanı. Sayfa numarası yerine imleç,
   * çünkü aradaki yeni mesajlar sayfa sınırlarını kaydırırdı.
   * `q` mesaj içinde arama — trigram indeksi üzerinden.
   */
  app.get<{ Params: { id: string }; Querystring: { before?: string; q?: string } }>(
    '/players/:id/chat',
    { preHandler: guard },
    async (req, reply) => {
      const id = req.params.id;
      if (!/^[0-9a-f-]{36}$/i.test(id)) {
        return reply.code(400).send({ error: 'gecersiz_oyuncu_id' });
      }
      const SAYFA = 100;
      const q = (req.query.q ?? '').trim();
      const before = req.query.before ? new Date(req.query.before) : null;
      if (before && Number.isNaN(before.getTime())) {
        return reply.code(400).send({ error: 'gecersiz_before' });
      }

      const kosullar = [eq(chatSchema.chatMessages.playerId, id)];
      if (before) kosullar.push(lt(chatSchema.chatMessages.sentAt, before));
      // ILIKE '%...%' trigram GIN indeksini kullanıyor; ölçüldü, 0,2 ms.
      if (q.length >= 2) kosullar.push(ilike(chatSchema.chatMessages.message, `%${q}%`));

      const rows = await db
        .select({
          id: chatSchema.chatMessages.id,
          channel: chatSchema.chatMessages.channel,
          message: chatSchema.chatMessages.message,
          sentAt: chatSchema.chatMessages.sentAt,
        })
        .from(chatSchema.chatMessages)
        .where(and(...kosullar))
        .orderBy(desc(chatSchema.chatMessages.sentAt))
        // Bir fazla çekip "devamı var mı" sorusunu ikinci bir COUNT sorgusu
        // olmadan cevaplıyoruz.
        .limit(SAYFA + 1);

      const devam = rows.length > SAYFA;
      return { mesajlar: rows.slice(0, SAYFA), devam };
    },
  );

  /**
   * Oyuncu profili — moderasyonun karar ekranı.
   *
   * Tek istekte veriliyor çünkü admin bu sayfaya "şu an ne yapmalıyım"
   * sorusuyla giriyor: ban geçmişi, etiketler, notlar ve oynama süresi
   * ayrı ayrı yüklenirse karar parça parça oluşuyor.
   *
   * Ağır olan tek şey oturum geçmişi (bir oyuncuda binlerce satır olabilir);
   * onu toplam olarak veriyoruz, listesini değil.
   */
  app.get<{ Params: { id: string } }>('/players/:id', { preHandler: guard }, async (req, reply) => {
    const id = req.params.id;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return reply.code(400).send({ error: 'gecersiz_oyuncu_id' });
    }

    const [player] = await db
      .select()
      .from(identitySchema.players)
      .where(eq(identitySchema.players.id, id))
      .limit(1);
    if (!player) return reply.code(404).send({ error: 'oyuncu_bulunamadi' });

    const [names, banRows, flagRows, records, sohbet, sure, sonOturum] = await Promise.all([
      db
        .select({
          name: identitySchema.playerNames.name,
          firstSeen: identitySchema.playerNames.firstSeen,
          lastSeen: identitySchema.playerNames.lastSeen,
        })
        .from(identitySchema.playerNames)
        .where(eq(identitySchema.playerNames.playerId, id))
        .orderBy(desc(identitySchema.playerNames.lastSeen))
        .limit(50),

      db
        .select()
        .from(moderationSchema.bans)
        .where(eq(moderationSchema.bans.playerId, id))
        .orderBy(desc(moderationSchema.bans.createdAt))
        .limit(100),

      db
        .select({
          id: moderationSchema.flagAssignments.id,
          flagId: moderationSchema.flags.id,
          name: moderationSchema.flags.name,
          color: moderationSchema.flags.color,
          addedAt: moderationSchema.flagAssignments.addedAt,
          removedAt: moderationSchema.flagAssignments.removedAt,
        })
        .from(moderationSchema.flagAssignments)
        .innerJoin(
          moderationSchema.flags,
          eq(moderationSchema.flags.id, moderationSchema.flagAssignments.flagId),
        )
        .where(eq(moderationSchema.flagAssignments.playerId, id))
        .orderBy(desc(moderationSchema.flagAssignments.addedAt))
        .limit(100),

      db
        .select()
        .from(moderationSchema.playerRecords)
        .where(eq(moderationSchema.playerRecords.playerId, id))
        .orderBy(desc(moderationSchema.playerRecords.createdAt))
        .limit(100),

      // Son mesajlar. Tamamı değil: aktif bir oyuncuda on binlerce satır
      // olabilir ve profil ekranında son konuşulanlar yeterli. Tam arama
      // ayrı bir ekranın işi.
      db
        .select({
          id: chatSchema.chatMessages.id,
          channel: chatSchema.chatMessages.channel,
          message: chatSchema.chatMessages.message,
          sentAt: chatSchema.chatMessages.sentAt,
        })
        .from(chatSchema.chatMessages)
        .where(eq(chatSchema.chatMessages.playerId, id))
        .orderBy(desc(chatSchema.chatMessages.sentAt))
        .limit(200),

      // Süre ve oturum sayısı: satırları taşımadan tek toplamda.
      db.execute<{ oturum: number; saniye: number; ilk: string | null; son: string | null }>(sql`
          select count(*)::int as oturum,
                 coalesce(sum(extract(epoch from (coalesce(left_at, now()) - joined_at))), 0)::bigint as saniye,
                 min(joined_at) as ilk,
                 max(joined_at) as son
            from game_sessions
           where player_id = ${id}
        `),

      db.execute<{ mac: number; kill: number; olum: number; revive: number }>(sql`
          select count(*)::int as mac,
                 coalesce(sum(kills), 0)::int as kill,
                 coalesce(sum(deaths), 0)::int as olum,
                 coalesce(sum(revives), 0)::int as revive
            from round_players
           where player_id = ${id}
        `),
    ]);

    const s = (sure as unknown as Record<string, unknown>[])[0] ?? {};
    const m = (sonOturum as unknown as Record<string, unknown>[])[0] ?? {};
    const now = new Date();

    return {
      player: {
        id: player.id,
        steamId: player.steamId,
        eosId: player.eosId,
        battlemetricsId: player.battlemetricsId,
        name: names[0]?.name ?? '(isim yok)',
      },
      names,
      bans: banRows.map((b) => ({
        ...b,
        // Kural tek yerde: lib/ban-active.ts. Ban listesi ucu da aynı
        // tanımı kullanıyor, böylece panel ile sunucu ayrışamaz.
        active: banAktifMi(b, now),
      })),
      flags: flagRows,
      records,
      sohbet,
      oyun: {
        oturum: Number(s.oturum ?? 0),
        toplamSaniye: Number(s.saniye ?? 0),
        ilkGorulme: s.ilk ?? null,
        sonGorulme: s.son ?? null,
        mac: Number(m.mac ?? 0),
        kill: Number(m.kill ?? 0),
        olum: Number(m.olum ?? 0),
        revive: Number(m.revive ?? 0),
      },
    };
  });
}

interface BaseRow {
  id: string;
  steamId: string | null;
  eosId: string | null;
  matchedName?: string;
  score?: number;
}

/**
 * Arama sonucuna moderasyon bağlamı ekler.
 *
 * Bir admin listede önce "bu oyuncunun banı var mı" görmek istiyor; profile
 * girmeye zorlamak her aramayı iki adıma çıkarırdı.
 */
async function decorate(db: Db, rows: BaseRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);

  /**
   * Oyuncu başına EN SON 5 isim.
   *
   * Önceki hâli tek bir global `limit` kullanıyordu (ids.length * 6) ve bu
   * yanlıştı: 99 ismi olan bir oyuncu bütün payı yiyip diğerlerinin isimlerini
   * sonuçtan düşürebiliyordu. Pencere fonksiyonu limiti oyuncu başına
   * uyguluyor.
   */
  const isimSatirlari = await db.execute<{
    player_id: string;
    name: string;
    sira: number;
    toplam: number;
  }>(sql`
    select player_id, name, sira, toplam
      from (
        select pn.player_id,
               pn.name,
               row_number() over (partition by pn.player_id order by pn.last_seen desc nulls last) as sira,
               count(*) over (partition by pn.player_id) as toplam
          from player_names pn
         where pn.player_id = any(${ids}::uuid[])
      ) x
     where sira <= 5
  `);

  const isimler = new Map<string, string[]>();
  const isimSayisi = new Map<string, number>();
  for (const r of isimSatirlari as unknown as Record<string, unknown>[]) {
    const pid = String(r.player_id);
    if (!isimler.has(pid)) isimler.set(pid, []);
    isimler.get(pid)?.push(String(r.name));
    isimSayisi.set(pid, Number(r.toplam ?? 0));
  }

  const now = new Date();
  const bans = await db
    .select({ playerId: moderationSchema.bans.playerId })
    .from(moderationSchema.bans)
    .where(
      and(
        // inArray: sql`= any(${ids})` JS dizisini tek parametre olarak
        // bağlıyor ve Postgres onu dizi olarak görmüyor ("op ANY/ALL
        // requires array on right side"). Gerçek kurulumda patladı.
        inArray(moderationSchema.bans.playerId, ids),
        aktifBanKosulu(now),
      ),
    );
  const banned = new Set(bans.map((b) => b.playerId));

  // Aktif etiketler. Kaldırılmış olanlar gelmiyor: arama listesinde geçmiş
  // değil ŞU ANKİ durum okunuyor.
  const etiketSatirlari = await db
    .select({
      playerId: moderationSchema.flagAssignments.playerId,
      name: moderationSchema.flags.name,
    })
    .from(moderationSchema.flagAssignments)
    .innerJoin(
      moderationSchema.flags,
      eq(moderationSchema.flags.id, moderationSchema.flagAssignments.flagId),
    )
    .where(
      and(
        inArray(moderationSchema.flagAssignments.playerId, ids),
        isNull(moderationSchema.flagAssignments.removedAt),
      ),
    );
  const etiketler = new Map<string, string[]>();
  for (const f of etiketSatirlari) {
    if (!etiketler.has(f.playerId)) etiketler.set(f.playerId, []);
    etiketler.get(f.playerId)?.push(f.name);
  }

  return rows.map((r) => {
    const hepsi = isimler.get(r.id) ?? [];
    const guncel = hepsi[0] ?? r.matchedName ?? '(isim yok)';
    return {
      id: r.id,
      steamId: r.steamId,
      eosId: r.eosId,
      name: guncel,
      matchedName: r.matchedName ?? null,
      // Güncel isim hariç eskiler; eşleşen isim zaten ayrıca gösteriliyor.
      eskiIsimler: hepsi.slice(1).filter((n) => n !== r.matchedName),
      knownNames: isimSayisi.get(r.id) ?? hepsi.length,
      flags: etiketler.get(r.id) ?? [],
      hasActiveBan: banned.has(r.id),
    };
  });
}

