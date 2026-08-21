import type { Db } from '@altai/db';
import { sql } from 'drizzle-orm';
import { galibiyetOrani, kdOrani } from './player-stats.js';

/**
 * Klan istatistikleri — plan Faz 5 ("klanlar: kadro, yönetim, stat").
 *
 * ÜYELİK ZAMANA BAĞLI hesaplanıyor. Bir oyuncunun bugün klanda olması,
 * altı ay önceki maçlarının o klana sayılacağı anlamına gelmiyor — ve
 * ayrılmış bir üyenin üyeyken oynadığı maçlar klanın geçmişinin parçası.
 * `clan_members` bu yüzden ayrılmayı silmek yerine işaretliyor
 * (bkz. şema notu: "bu oyuncu o maçta hangi klandaydı").
 *
 * Basit yol (bugünün üye listesini alıp tüm maçlarını toplamak) daha kolay
 * olurdu ama yanlış: dün transfer olan bir oyuncunun eski klanındaki 300
 * maçı yeni klanına yazılırdı.
 */

export interface KlanIstatistigi {
  clanId: string;
  /** Aktif üye sayısı (şu an). */
  uyeSayisi: number;
  /** Dönem içinde en az bir maç oynamış üye sayısı. */
  aktifUye: number;
  /** Üyelerin oynadığı FARKLI maç sayısı — satır toplamı değil. */
  maclar: number;
  kills: number;
  deaths: number;
  revives: number;
  teamkills: number;
  kdr: number;
  wins: number;
  losses: number;
  winRate: number | null;
}

/** Boş istatistik — hiç maçı olmayan klan. */
export function bosKlanIstatistigi(clanId: string, uyeSayisi = 0): KlanIstatistigi {
  return {
    clanId,
    uyeSayisi,
    aktifUye: 0,
    maclar: 0,
    kills: 0,
    deaths: 0,
    revives: 0,
    teamkills: 0,
    kdr: 0,
    wins: 0,
    losses: 0,
    winRate: null,
  };
}

/**
 * Tek klanın istatistiği.
 *
 * `days` verilmezse tüm zamanlar.
 *
 * Maç sayısı `count(distinct round_id)`: on üyesi olan bir klanın tek
 * maçı on satır üretiyor ve satırları saymak "10 maç oynadık" demek
 * olurdu.
 */
export async function klanIstatistigi(
  db: Db,
  clanId: string,
  days?: number | null,
): Promise<KlanIstatistigi> {
  const zamanSuzgeci = days ? sql`and r.started_at >= now() - ${`${days} days`}::interval` : sql``;

  const res = await db.execute(sql`
    select count(distinct rp.round_id)::int                    as maclar,
           count(distinct rp.player_id)::int                   as aktif_uye,
           coalesce(sum(rp.kills), 0)::int                     as kills,
           coalesce(sum(rp.deaths), 0)::int                    as deaths,
           coalesce(sum(rp.revives), 0)::int                   as revives,
           coalesce(sum(rp.teamkills), 0)::int                 as teamkills,
           count(*) filter (where rp.is_winner is true)::int   as wins,
           count(*) filter (where rp.is_winner is false)::int  as losses
      from clan_members cm
      join round_players rp on rp.player_id = cm.player_id
      join rounds r on r.id = rp.round_id
     where cm.clan_id = ${clanId}
       -- ÜYELİK PENCERESİ: maç, oyuncunun klanda OLDUĞU dönemde
       -- oynanmış olmalı. Bu koşul olmadan dün transfer olan birinin
       -- eski klanındaki bütün maçları buraya yazılırdı.
       and r.started_at >= cm.added_at
       and (cm.removed_at is null or r.started_at <= cm.removed_at)
       ${zamanSuzgeci}
  `);

  const r = (res as unknown as Record<string, unknown>[])[0] ?? {};
  const uyeSayisi = await aktifUyeSayisi(db, clanId);
  const kills = Number(r.kills ?? 0);
  const deaths = Number(r.deaths ?? 0);
  const wins = Number(r.wins ?? 0);
  const losses = Number(r.losses ?? 0);

  return {
    clanId,
    uyeSayisi,
    aktifUye: Number(r.aktif_uye ?? 0),
    maclar: Number(r.maclar ?? 0),
    kills,
    deaths,
    revives: Number(r.revives ?? 0),
    teamkills: Number(r.teamkills ?? 0),
    kdr: kdOrani(kills, deaths),
    wins,
    losses,
    winRate: galibiyetOrani(wins, losses),
  };
}

/** Klanın ŞU ANKİ aktif üye sayısı. */
async function aktifUyeSayisi(db: Db, clanId: string): Promise<number> {
  const res = await db.execute(sql`
    select count(*)::int as adet
      from clan_members
     where clan_id = ${clanId}
       and removed_at is null
  `);
  const r = (res as unknown as Record<string, unknown>[])[0] ?? {};
  return Number(r.adet ?? 0);
}

export interface KlanUyeSatiri {
  playerId: string;
  steamId: string | null;
  name: string | null;
  maclar: number;
  kills: number;
  deaths: number;
  revives: number;
  kdr: number;
}

/**
 * Klanın üyeleri, katkıya göre sıralı.
 *
 * Yalnızca AKTİF üyeler: ayrılmış birini "klanın en iyi oyuncusu" diye
 * göstermek, kadroya bakan kişiye yanlış bilgi verirdi. Onların maçları
 * klanın toplamına yine sayılıyor (üye oldukları dönem için) — kadro
 * listesi ile tarihçe ayrı sorular.
 */
export async function klanUyeleri(
  db: Db,
  clanId: string,
  days?: number | null,
): Promise<KlanUyeSatiri[]> {
  const zamanSuzgeci = days ? sql`and r.started_at >= now() - ${`${days} days`}::interval` : sql``;

  const res = await db.execute(sql`
    select cm.player_id,
           p.steam_id,
           (select pn.name
              from player_names pn
             where pn.player_id = cm.player_id
             order by pn.last_seen desc nulls last
             limit 1) as name,
           -- filter (where r.id is not null) ŞART ve bu bir hata
           -- düzeltmesi: üyelik penceresi koşulları rounds join'inde
           -- ama round_players join'i oyuncunun BÜTÜN satırlarını
           -- getiriyor. Pencereye uymayan satırlarda r null oluyor,
           -- yine de rp.kills toplama giriyordu. Gerçek veriyle
           -- görüldü: klana dün katılan bir oyuncu 253 öldürmeyle
           -- listelendi, doğrusu 4'tü.
           count(distinct r.id)::int                                   as maclar,
           coalesce(sum(rp.kills) filter (where r.id is not null), 0)::int    as kills,
           coalesce(sum(rp.deaths) filter (where r.id is not null), 0)::int   as deaths,
           coalesce(sum(rp.revives) filter (where r.id is not null), 0)::int  as revives
      from clan_members cm
      join players p on p.id = cm.player_id
      -- LEFT JOIN: hiç maç oynamamış üye de kadroda görünmeli. inner
      -- join, yeni katılan üyeleri listeden düşürürdü.
      left join round_players rp on rp.player_id = cm.player_id
      left join rounds r on r.id = rp.round_id
       and r.started_at >= cm.added_at
       and (cm.removed_at is null or r.started_at <= cm.removed_at)
       ${zamanSuzgeci}
     where cm.clan_id = ${clanId}
       and cm.removed_at is null
     group by cm.player_id, p.steam_id
     order by kills desc, maclar desc
     limit 100
  `);

  return (res as unknown as Record<string, unknown>[]).map((row) => {
    const kills = Number(row.kills ?? 0);
    const deaths = Number(row.deaths ?? 0);
    return {
      playerId: String(row.player_id),
      steamId: row.steam_id === null || row.steam_id === undefined ? null : String(row.steam_id),
      name: row.name === null || row.name === undefined ? null : String(row.name),
      maclar: Number(row.maclar ?? 0),
      kills,
      deaths,
      revives: Number(row.revives ?? 0),
      kdr: kdOrani(kills, deaths),
    };
  });
}
