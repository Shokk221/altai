import { moderationSchema } from '@altai/db';
import { type SQL, and, gt, isNull, or } from 'drizzle-orm';

/**
 * "Bu ban şu an geçerli mi" — TEK tanım.
 *
 * Kural üç yerde ayrı ayrı yazılmıştı: ban listesi ucunun SQL filtresinde,
 * liste render'ında ve oyuncu profilinde. Aynı kuralın üç kopyası, birinde
 * yapılan bir düzeltmenin diğerlerine geçmemesi demek — ve bu kural
 * "oyuncu sunucuya girebilir mi" sorusunu belirliyor. Panelin "ban aktif
 * değil" dediği bir oyuncunun sunucuya alınmaması (ya da tersi) en kötü
 * hata sınıfı.
 *
 * İki biçim de burada, yan yana: biri veritabanına sorulur, biri elde
 * hesaplanır. Biri değişirse diğeri de değişmeli — ve bunu testler
 * karşılaştırarak kontrol ediyor.
 *
 * Kural: ban geçerlidir ⟺ kaldırılmamış VE (kalıcı VEYA bitişi gelecekte).
 */

export interface BanZamanlari {
  revokedAt: Date | null;
  expiresAt: Date | null;
}

/** Elde hesaplama — profil, render ve testler için. */
export function banAktifMi(ban: BanZamanlari, now: Date): boolean {
  if (ban.revokedAt) return false;
  if (!ban.expiresAt) return true;
  return ban.expiresAt.getTime() > now.getTime();
}

/**
 * Veritabanı filtresi — aynı kuralın SQL karşılığı.
 *
 * `gt` kullanılıyor, `gte` değil: tam bitiş anında ban artık geçerli değil.
 * (Daha önce bir yerde `eq` yazılmıştı ve süresi dolmamış tüm kayıtları
 * eliyordu — o yüzden burada açıkça yazılı duruyor.)
 */
export function aktifBanKosulu(now: Date): SQL | undefined {
  return and(
    isNull(moderationSchema.bans.revokedAt),
    or(isNull(moderationSchema.bans.expiresAt), gt(moderationSchema.bans.expiresAt, now)),
  );
}
