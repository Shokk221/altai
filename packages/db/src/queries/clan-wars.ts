import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../client.js';
import * as communitySchema from '../schema/community.js';
import * as identitySchema from '../schema/identity.js';

/**
 * Klan savaşı iş mantığı — plan Faz 5.
 *
 * Yaptırımın dayandığı liste burada üretiliyor ve tek kaynak: api hem
 * panele hem (sorgu kanalı üzerinden) agent'a aynı listeyi veriyor.
 * İki ayrı hesap, panelde izinli görünen birinin oyunda atılması demekti.
 */

export const SAVAS_DURUMLARI = ['planned', 'lobby', 'live', 'finished', 'cancelled'] as const;
export type SavasDurumu = (typeof SAVAS_DURUMLARI)[number];

export interface SavasKadrosu {
  /** Bu sunucuda ŞU AN yaptırım uygulanan bir savaş var mı? */
  aktif: boolean;
  warId: string | null;
  name: string | null;
  /** İzinli oyuncuların SteamID'leri (küçük harfe çevrilmemiş). */
  steamIds: string[];
  /** İzinli oyuncuların EOS kimlikleri (küçük harf). */
  eosIds: string[];
}

/**
 * Sunucuda yaptırım uygulanan savaşın kadrosu.
 *
 * YALNIZCA `live` durumundaki savaş sayılıyor. `lobby` kadroların
 * toplandığı aşama ve o sırada kimse atılmamalı — hazırlık yapan
 * oyuncuları sunucudan atmak, maçı başlamadan bozardı.
 *
 * `aktif: false` dönerse plugin hiçbir şey yapmıyor. Boş bir kadro ile
 * "savaş yok" arasındaki fark kritik: boş kadrolu bir savaşta HERKES
 * atılırdı ve bu, kadro girilmeden başlatılan bir savaşta sunucuyu
 * boşaltmak demekti.
 */
export async function savasKadrosu(db: Db, serverId: string): Promise<SavasKadrosu> {
  const [savas] = await db
    .select({
      id: communitySchema.clanWars.id,
      name: communitySchema.clanWars.name,
    })
    .from(communitySchema.clanWars)
    .where(
      and(
        eq(communitySchema.clanWars.serverId, serverId),
        eq(communitySchema.clanWars.status, 'live'),
      ),
    )
    .orderBy(asc(communitySchema.clanWars.scheduledAt))
    .limit(1);

  if (!savas) return { aktif: false, warId: null, name: null, steamIds: [], eosIds: [] };

  const satirlar = await db
    .select({
      steamId: identitySchema.players.steamId,
      eosId: identitySchema.players.eosId,
    })
    .from(communitySchema.clanWarRoster)
    .innerJoin(
      identitySchema.players,
      eq(identitySchema.players.id, communitySchema.clanWarRoster.playerId),
    )
    .where(eq(communitySchema.clanWarRoster.warId, savas.id));

  return {
    aktif: true,
    warId: savas.id,
    name: savas.name,
    steamIds: satirlar.map((s) => s.steamId).filter((s): s is string => Boolean(s)),
    eosIds: satirlar
      .map((s) => s.eosId)
      .filter((s): s is string => Boolean(s))
      .map((s) => s.toLowerCase()),
  };
}

export interface KadroEklemeSonucu {
  eklenen: number;
  zatenKadroda: number;
  /** Klanın üyesi olmayan ama yine de eklenen oyuncular. */
  klanDisi: number;
  gecersiz: string[];
  kilitli: boolean;
}

/**
 * Kadroya SteamID listesiyle oyuncu ekler.
 *
 * Klan üyeliği ARANMIYOR ama üye olmayanlar sayılıp bildiriliyor. Sebep:
 * klan savaşlarında ödünç oyuncu yaygın ("bu maçta bizde oynuyor") ve
 * bunu engellemek gerçek kullanımı kırardı. Ama sessizce geçmek de
 * olmaz — yanlış listeyi yapıştıran kişi bunu görmeli.
 *
 * Kilitli savaşta ekleme YAPILMIYOR: kilit, karşı tarafın kabul ettiği
 * kadronun sabitlendiği an.
 */
export async function kadroyaEkle(
  db: Db,
  warId: string,
  clanId: string,
  hamListe: string,
): Promise<KadroEklemeSonucu> {
  const [savas] = await db
    .select({ lockedAt: communitySchema.clanWars.lockedAt })
    .from(communitySchema.clanWars)
    .where(eq(communitySchema.clanWars.id, warId))
    .limit(1);

  if (!savas) return { eklenen: 0, zatenKadroda: 0, klanDisi: 0, gecersiz: [], kilitli: false };
  if (savas.lockedAt) {
    return { eklenen: 0, zatenKadroda: 0, klanDisi: 0, gecersiz: [], kilitli: true };
  }

  const { steamIds, gecersiz } = steamIdAyikla(hamListe);
  if (steamIds.length === 0) {
    return { eklenen: 0, zatenKadroda: 0, klanDisi: 0, gecersiz, kilitli: false };
  }

  const oyuncular = await db
    .select({ id: identitySchema.players.id, steamId: identitySchema.players.steamId })
    .from(identitySchema.players)
    .where(inArray(identitySchema.players.steamId, steamIds));

  const bulunanlar = new Set(oyuncular.map((o) => o.steamId));
  // Veritabanında hiç görülmemiş SteamID'ler geçersiz sayılıyor —
  // oyuncu kaydı BURADA oluşturulmuyor. Klan savaşı kadrosu, sunucuya hiç
  // girmemiş birini içeriyorsa bu bir yazım hatası ihtimali ve sessizce
  // kayıt açmak o hatayı gizlerdi.
  for (const s of steamIds) if (!bulunanlar.has(s)) gecersiz.push(s);

  if (oyuncular.length === 0) {
    return { eklenen: 0, zatenKadroda: 0, klanDisi: 0, gecersiz, kilitli: false };
  }

  // Klan üyesi olmayanları saymak için aktif üyelik listesi.
  const uyeler = await db
    .select({ playerId: identitySchema.clanMembers.playerId })
    .from(identitySchema.clanMembers)
    .where(
      and(
        eq(identitySchema.clanMembers.clanId, clanId),
        isNull(identitySchema.clanMembers.removedAt),
      ),
    );
  const uyeKumesi = new Set(uyeler.map((u) => u.playerId));

  const eklenenler = await db
    .insert(communitySchema.clanWarRoster)
    .values(oyuncular.map((o) => ({ warId, clanId, playerId: o.id })))
    .onConflictDoNothing()
    .returning({ playerId: communitySchema.clanWarRoster.playerId });

  const eklenenKumesi = new Set(eklenenler.map((e) => e.playerId));
  return {
    eklenen: eklenenler.length,
    zatenKadroda: oyuncular.length - eklenenler.length,
    klanDisi: oyuncular.filter((o) => eklenenKumesi.has(o.id) && !uyeKumesi.has(o.id)).length,
    gecersiz,
    kilitli: false,
  };
}

/**
 * Serbest metinden SteamID'leri ayıklar.
 *
 * Satır sonu, virgül, boşluk ve profil bağlantısı kabul ediliyor: klan
 * sorumlusu listeyi olduğu gibi yapıştırıyor, tek tek girmiyor.
 * Okunamayanlar SAYILIYOR ve geri bildiriliyor — 20 kişilik bir listenin
 * 3'ünün sessizce düşmesi, maç gecesi üç kişinin sunucuya girememesi
 * demekti.
 */
export function steamIdAyikla(ham: string): { steamIds: string[]; gecersiz: string[] } {
  const parcalar = ham
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const steamIds: string[] = [];
  const gecersiz: string[] = [];
  const gorulen = new Set<string>();

  for (const parca of parcalar) {
    const m = parca.match(/(7656119\d{10})/);
    if (!m?.[1]) {
      gecersiz.push(parca);
      continue;
    }
    // Aynı kimlik iki kez yazılmışsa bir kez alınıyor; tekrar bir hata
    // değil, listeyi birleştirirken sık oluyor.
    if (gorulen.has(m[1])) continue;
    gorulen.add(m[1]);
    steamIds.push(m[1]);
  }
  return { steamIds, gecersiz };
}

/** Kadroyu kilitler. Kilitli savaş tekrar kilitlenmiyor. */
export async function kadroyuKilitle(db: Db, warId: string): Promise<boolean> {
  const sonuc = await db
    .update(communitySchema.clanWars)
    .set({ lockedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(communitySchema.clanWars.id, warId), isNull(communitySchema.clanWars.lockedAt)))
    .returning({ id: communitySchema.clanWars.id });
  return sonuc.length > 0;
}

/**
 * Savaşın durumunu değiştirir.
 *
 * `live`'a geçiş KADRO BOŞKEN engelleniyor. Boş kadrolu bir savaşta
 * yaptırım herkesi atardı ve sunucu bir anda boşalırdı — bu, "başlat"a
 * basan kişinin beklediği şey değil.
 */
export async function durumDegistir(
  db: Db,
  warId: string,
  durum: SavasDurumu,
): Promise<{ ok: boolean; sebep?: string }> {
  if (durum === 'live') {
    const res = await db.execute(sql`
      select count(*)::int as adet from clan_war_roster where war_id = ${warId}
    `);
    const r = (res as unknown as Record<string, unknown>[])[0] ?? {};
    if (Number(r.adet ?? 0) === 0) return { ok: false, sebep: 'kadro_bos' };
  }

  const sonuc = await db
    .update(communitySchema.clanWars)
    .set({ status: durum, updatedAt: new Date() })
    .where(eq(communitySchema.clanWars.id, warId))
    .returning({ id: communitySchema.clanWars.id });
  return { ok: sonuc.length > 0 };
}
