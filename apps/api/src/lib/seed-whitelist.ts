import type { Db } from '@altai/db';
import { accessSchema } from '@altai/db';
import { presenceSchema } from '@altai/db';
import { logger } from '@altai/shared';
import { and, eq, gte, isNull, or, sql } from 'drizzle-orm';

/**
 * Haftalık seed ödülü: yeterince seed yapan oyuncuya whitelist verilir.
 *
 * Eski `SeedWLTracker` bu kararı OYUN SUNUCUSUNDA veriyordu — plugin
 * Mongo'ya aggregate atıp eşiği geçeni bulunca kendisi `AdminEntry`
 * yazıyordu. İki sorun vardı: (1) hangi sürelerin sayıldığı ve ödülün ne
 * kadar sürdüğü oyun sunucusundaki bir dosyada gömülüydü, (2) iki sunucu
 * aynı anda çalıştığında ikisi de aynı oyuncuya ayrı ayrı ödül yazabiliyordu.
 *
 * Burada karar api'de. Süreleri zaten api topluyor, whitelist de api'nin
 * ürettiği Admins.cfg'ye gidiyor; kararın da orada olması doğal. Çift
 * ödül sorunu da kendiliğinden çözülüyor: tek bir yazan var.
 */

/** Haftanın başlangıcı (Pazar 00:00, sunucunun yerel saati). */
export function haftaBasi(simdi: Date = new Date()): Date {
  const bas = new Date(simdi);
  bas.setDate(bas.getDate() - bas.getDay());
  bas.setHours(0, 0, 0, 0);
  return bas;
}

export interface SeedOdulAyari {
  /** Ödül için gereken haftalık dakika. 0 = ödül kapalı. */
  hedefDakika: number;
  /** Verilecek grant grubu (Admins.cfg'deki grup adı). */
  grupAdi: string;
  /** Ödülün kaç gün geçerli olacağı. */
  gecerlilikGun: number;
}

export const VARSAYILAN_ODUL: SeedOdulAyari = {
  hedefDakika: 300,
  grupAdi: 'SeedWL',
  gecerlilikGun: 7,
};

/**
 * Oyuncunun bu haftaki toplam seed süresi (saniye).
 *
 * Admin nöbetinden farklı olarak BÜTÜN seed sebepleri sayılıyor: eski
 * `SeedWLTracker` de sunucu az doluyken geçen süreyi ödüle katıyordu.
 */
export async function haftalikSeedSaniyesi(
  db: Db,
  playerId: string,
  simdi: Date = new Date(),
): Promise<number> {
  const [satir] = await db
    .select({
      toplam: sql<number>`coalesce(sum(${presenceSchema.seedSessions.durationSeconds}), 0)`,
    })
    .from(presenceSchema.seedSessions)
    .where(
      and(
        eq(presenceSchema.seedSessions.playerId, playerId),
        gte(presenceSchema.seedSessions.startedAt, haftaBasi(simdi)),
      ),
    );
  return Number(satir?.toplam ?? 0);
}

/**
 * Oyuncunun şu an geçerli bir seed ödülü var mı?
 *
 * "Geçerli" = iptal edilmemiş VE (süresiz ya da süresi dolmamış). Süresi
 * geçmiş kayıt SİLİNMİYOR (bkz. grants.expiresAt yorumu), o yüzden
 * varlığına değil geçerliliğine bakmak gerekiyor.
 */
export async function aktifOdulVarMi(
  db: Db,
  playerId: string,
  grupAdi: string,
  simdi: Date = new Date(),
): Promise<boolean> {
  const [satir] = await db
    .select({ id: accessSchema.grants.id })
    .from(accessSchema.grants)
    .where(
      and(
        eq(accessSchema.grants.playerId, playerId),
        eq(accessSchema.grants.groupName, grupAdi),
        isNull(accessSchema.grants.revokedAt),
        or(isNull(accessSchema.grants.expiresAt), gte(accessSchema.grants.expiresAt, simdi)),
      ),
    )
    .limit(1);
  return Boolean(satir);
}

/**
 * Eşiği geçtiyse ödülü verir. Verdiyse `true` döner.
 *
 * Hiçbir durumda throw etmez: bu kontrol bir seed kaydı yazıldıktan SONRA
 * çalışıyor ve başarısız olması o kaydı geçersiz kılmamalı.
 */
export async function seedOdulunuDegerlendir(
  db: Db,
  playerId: string,
  ayar: SeedOdulAyari = VARSAYILAN_ODUL,
  simdi: Date = new Date(),
): Promise<boolean> {
  if (ayar.hedefDakika <= 0) return false;

  try {
    if (await aktifOdulVarMi(db, playerId, ayar.grupAdi, simdi)) return false;

    const saniye = await haftalikSeedSaniyesi(db, playerId, simdi);
    if (saniye < ayar.hedefDakika * 60) return false;

    const biter = new Date(simdi.getTime() + ayar.gecerlilikGun * 24 * 60 * 60 * 1000);
    await db.insert(accessSchema.grants).values({
      playerId,
      groupName: ayar.grupAdi,
      // 'manual' — Discord rolünden türemiyor. Ödül olduğu comment'te.
      origin: 'manual',
      comment: `Haftalık seed ödülü (${Math.floor(saniye / 60)} dk)`,
      grantedAt: simdi,
      expiresAt: biter,
    });

    logger.info(
      { playerId, dakika: Math.floor(saniye / 60), grup: ayar.grupAdi, biter },
      'haftalık seed ödülü verildi',
    );
    return true;
  } catch (err) {
    logger.error({ err, playerId }, 'seed ödülü değerlendirilemedi');
    return false;
  }
}
