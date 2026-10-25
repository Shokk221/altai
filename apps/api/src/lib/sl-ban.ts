import type { Db } from '@altai/db';
import { moderationSchema } from '@altai/db';
import { logger } from '@altai/shared';

/**
 * SL ban — oyuncuyu sunucudan atmadan manga liderliğinden men eder.
 *
 * Yaptırım bir ETİKET üzerinden yürüyor, ayrı bir tablo üzerinden değil:
 * agent'taki `sl-ban-enforcer` eklentisi bu adı taşıyan aktif etikete
 * bakıp oyuncuyu liderlikten çıkarıyor. Mekanizma zaten çalışıyordu;
 * panelden verilebilir hâle getirilmesi için yeni bir yol açmak yerine
 * çalışan yola bağlanıyor.
 *
 * Oyun banıyla AYNI TABLOYU PAYLAŞMIYOR, bilerek: `bans` tablosuna
 * düşen bir kayıt ban listesine (.cfg) ve giriş kickine karışabilirdi.
 * "Manga lideri olamasın" dedi diye birini sunucudan atmak, bu
 * özellikteki en kötü hata olurdu.
 */

/**
 * Etiketin adı.
 *
 * Canlıda bu etiket BM'den aktarılmış olarak duruyor (`source` =
 * battlemetrics, 167 aktif atama) ve agent eklentisi adı HARF DUYARSIZ
 * karşılaştırıyor. Bu yüzden yazım farkı sorun değil, ama etiketin
 * KENDİSİ tek olmalı.
 */
export const SL_BAN_ETIKETI = 'SL ban';

const ayni = (a: string, b: string) =>
  a.trim().toLocaleUpperCase('tr-TR') === b.trim().toLocaleUpperCase('tr-TR');

/**
 * SL ban etiketinin id'si; yoksa oluşturur.
 *
 * MEVCUT ETİKETİ KULLANIYOR, yenisini yaratmıyor. `flagIdBulVeyaOlustur`
 * yalnızca `source='altai'` etiketlere bakıyor ve burada kullanılsaydı
 * canlıda ikinci bir "SL ban" etiketi doğardı: aynı adı taşıyan iki rozet,
 * ikiye bölünmüş atamalar ve "bu oyuncuda SL ban var mı" sorusuna hangi
 * etikete bakıldığına göre değişen cevap. Şema yorumu bu tuzağı zaten
 * anlatıyor (flags_altai_name_idx).
 *
 * Karşılaştırma SQL'de değil burada: harf duyarsızlık Türkçe'ye özgü
 * (İ/ı) ve veritabanının collation'ına bırakılamaz — agent-queries'teki
 * etiket eşleştirmesiyle aynı gerekçe.
 */
export async function slBanEtiketId(db: Db): Promise<string | null> {
  const hepsi = await db
    .select({
      id: moderationSchema.flags.id,
      name: moderationSchema.flags.name,
      createdAt: moderationSchema.flags.createdAt,
    })
    .from(moderationSchema.flags);

  const eslesen = hepsi
    .filter((f) => ayni(f.name, SL_BAN_ETIKETI))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  if (eslesen.length > 1) {
    // Tek olmalıydı. Atamaların bölünmemesi için en eskisinde karar
    // kılıyoruz ama durum kayda geçiyor: elle birleştirilmesi gerekir.
    logger.warn(
      { adet: eslesen.length, idler: eslesen.map((f) => f.id) },
      'aynı adı taşıyan birden fazla SL ban etiketi var',
    );
  }
  if (eslesen[0]) return eslesen[0].id;

  const [olusan] = await db
    .insert(moderationSchema.flags)
    .values({
      name: SL_BAN_ETIKETI,
      description: 'Manga lideri olamaz. Oyundan ban değildir.',
      color: '#b45309',
    })
    .onConflictDoNothing()
    .returning({ id: moderationSchema.flags.id });
  if (olusan) return olusan.id;

  // Yarış: kaybeden taraf kazananın satırını okur.
  const tekrar = await db
    .select({ id: moderationSchema.flags.id, name: moderationSchema.flags.name })
    .from(moderationSchema.flags);
  return tekrar.find((f) => ayni(f.name, SL_BAN_ETIKETI))?.id ?? null;
}
