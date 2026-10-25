import { moderationSchema } from '@altai/db';
import { type SQL, and, eq, gt, isNull, or } from 'drizzle-orm';

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

/**
 * Yaptırım kipi. `packages/shared` içindeki BAN_ENFORCEMENT ile aynı küme;
 * tanım burada çünkü valfi kullanan iki yol da buradan okuyor.
 */
export type YaptirimKipi = 'on' | 'altai' | 'dry' | 'off';

/**
 * GÜVENLİK VALFİ — `altai` kipinde yalnızca panelden atılan banlar.
 *
 * Veritabanındaki aktif banların neredeyse tamamı BattleMetrics'ten
 * aktarılmış DONDURULMUŞ bir kopya. O kopyadan sonra affedilmiş birini
 * haksız yere atma riskine girmemek için `altai` kipinde eski banlara
 * dokunmuyoruz; onları eski sistem zaten uyguluyor.
 *
 * NEDEN BURADA, ban-enforcer'ın içinde değil: yaptırımın İKİ yolu var ve
 * valf uzun süre yalnızca birinde vardı.
 *
 *   1. ban-enforcer  — girişte canlı RCON kicki        (valf vardı)
 *   2. ban-list ucu  — oyun sunucusunun çektiği .cfg   (valf YOKTU)
 *
 * İkinci yol, valfin ASIL gerekli olacağı anda devreye giriyor: oyun
 * sunucusunun RemoteBanListHosts.cfg'si bu uca çevrildiği gün. O gün valf
 * olmasa dondurulmuş arşivin tamamı tek seferde uygulanmaya başlardı —
 * yani `altai` kipinin önlemek için var olduğu şey. Kural tek yerde
 * durmazsa bu tür bir yol bir daha atlanır.
 *
 * `dry` ve `off` KASTEN süzmüyor: o kipler kickin yapılıp yapılmayacağını
 * belirliyor, hangi banların geçerli olduğunu değil. Liste için anlamlarını
 * burada icat etmiyoruz.
 */
export function yaptirimKaynakKosulu(kip: YaptirimKipi): SQL | undefined {
  return kip === 'altai' ? eq(moderationSchema.bans.source, 'altai') : undefined;
}
