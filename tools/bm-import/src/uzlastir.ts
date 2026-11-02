import path from 'node:path';
import type { Db } from '@altai/db';
import { moderationSchema } from '@altai/db';
import { logger } from '@altai/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { type BmRecord, readNdjson } from './ndjson.js';

/**
 * Arşivi BM'nin ŞU ANKİ hâliyle uzlaştırır.
 *
 * NEDEN GEREKLİ: `importBans` banları `onConflictDoNothing` ile yazıyor,
 * yani yeniden içe aktarım mevcut kayda HİÇ DOKUNMUYOR. Sonuç: arşiv
 * alındığı güne donuyor. BM'de kaldırılan bir ban bizde sonsuza dek aktif
 * kalıyor, değişen süre eski hâliyle duruyor.
 *
 * Bu, yaptırımı devralmanın önündeki asıl engel. Oyun sunucusunun ban
 * listesini bize çevirdiğimiz gün, BM'de affedilmiş insanlar sunucuya
 * giremez — ve bunu kimse fark etmez, çünkü "ban duruyor" ile "ban
 * kaldırılmıştı ama bizde duruyor" panelde aynı görünür.
 *
 * ÜÇ İŞ VAR:
 *   1. BM'de olup bizde olmayan   -> eklenir   (importBans zaten yapıyor)
 *   2. İkisinde de olan           -> güncellenir
 *   3. Bizde aktif, BM'de YOK     -> düşürülür (revokedAt)
 *
 * Üçüncüsü tehlikeli olan. Eksik ya da yarım kalmış bir dışa aktarım,
 * "BM'de yok" diye 21.796 banın tamamını düşürebilir — yani toplu ban
 * kalkması. Bu yüzden karar `dusurmeKarari` ile ayrı, saf ve test
 * edilebilir: sayılar makul değilse düşürme HİÇ yapılmıyor.
 */

export interface DusurmeKarari {
  guvenli: boolean;
  /** Güvenli değilse sebebi — yetkiliye ne olduğunu söylemek için. */
  gerekce?: string;
}

/**
 * Arşiv, bizdeki aktif ban sayısının bu oranından küçükse eksik sayılıyor.
 *
 * Yarım kalmış bir dışa aktarım (ağ koptu, kota doldu, süreç öldü) kısmi
 * bir `bans.ndjson` bırakıyor. Onu "BM'nin şu anki hâli" sanmak, eksik
 * kalan her banı düşürmek demek.
 */
const EN_AZ_ARSIV_ORANI = 0.5;

/**
 * Tek seferde düşürülebilecek azami oran.
 *
 * Normal bir uzlaştırmada düşecek ban azdır (aradaki sürede affedilenler).
 * Aktif banların beşte birinden fazlası düşüyorsa bu bir temizlik değil,
 * bir arıza belirtisidir — ve geri alması pahalıdır.
 */
const EN_COK_DUSURME_ORANI = 0.2;

/**
 * Düşürme adımı güvenli mi?
 *
 * Saf fonksiyon: veritabanına da dosyaya da dokunmuyor. Karar burada
 * çünkü yanlışı sessiz ve toplu — testle kilitlenmesi gereken tam da bu.
 */
export function dusurmeKarari(
  bizdekiAktif: number,
  dusecek: number,
  arsivdeki: number,
): DusurmeKarari {
  if (arsivdeki === 0) {
    return { guvenli: false, gerekce: 'arşivde hiç ban yok — dışa aktarım boş ya da bozuk' };
  }
  // Bizde hiç aktif ban yoksa düşürecek bir şey de yok; karar serbest.
  if (bizdekiAktif === 0) return { guvenli: true };

  if (arsivdeki < bizdekiAktif * EN_AZ_ARSIV_ORANI) {
    return {
      guvenli: false,
      gerekce: `arşivde ${arsivdeki} ban var ama bizde ${bizdekiAktif} aktif ban duruyor; dışa aktarım yarım kalmış olabilir`,
    };
  }

  if (dusecek > bizdekiAktif * EN_COK_DUSURME_ORANI) {
    const yuzde = Math.round((dusecek / bizdekiAktif) * 100);
    return {
      guvenli: false,
      gerekce: `aktif banların %${yuzde}'i (${dusecek} ban) düşecekti — tek seferde fazla`,
    };
  }

  return { guvenli: true };
}

export interface UzlastirmaFarki {
  /** Taze arşivdeki ban sayısı. */
  arsivdeki: number;
  /** Bizdeki aktif BM banı sayısı. */
  bizdekiAktif: number;
  /** İkisinde de var — alanları güncellenecek. */
  guncellenecek: string[];
  /** Bizde aktif, arşivde yok — düşürülecek. */
  dusecek: string[];
  /** Arşivde var, bizde hiç yok — eklenecek. */
  yeni: string[];
}

/**
 * İki kimlik kümesini karşılaştırır.
 *
 * Ayrı ve saf: "hangi ban düşecek" sorusu veritabanı olmadan
 * cevaplanabilmeli, çünkü yanlış cevabın bedeli toplu ban kalkması.
 *
 * `bizdekiTumu` AKTİF OLMAYANLARI da içeriyor: zaten düşmüş bir ban
 * arşivde yoksa tekrar düşürülmemeli (`dusecek` yalnızca aktiflerden
 * üretiliyor), ama arşivde VARSA da "yeni" sayılmamalı — o kayıt bizde
 * zaten var, yalnızca kaldırılmış.
 */
export function uzlastirmaFarki(
  arsivKimlikleri: Iterable<string>,
  bizdekiAktifler: Iterable<string>,
  bizdekiTumu: Iterable<string>,
): UzlastirmaFarki {
  const arsiv = new Set(arsivKimlikleri);
  const aktif = new Set(bizdekiAktifler);
  const tumu = new Set(bizdekiTumu);

  const guncellenecek: string[] = [];
  const yeni: string[] = [];
  for (const id of arsiv) {
    if (tumu.has(id)) guncellenecek.push(id);
    else yeni.push(id);
  }

  const dusecek: string[] = [];
  for (const id of aktif) if (!arsiv.has(id)) dusecek.push(id);

  return {
    arsivdeki: arsiv.size,
    bizdekiAktif: aktif.size,
    guncellenecek,
    dusecek,
    yeni,
  };
}

const SOURCE = 'battlemetrics' as const;
/** Tek IN(...) sorgusuna sığacak kimlik sayısı. */
const PARCA = 500;

export interface UzlastirmaOzeti extends UzlastirmaFarki {
  karar: DusurmeKarari;
  /** Gerçekten yazıldı mı (kuru koşuda false). */
  yazildi: boolean;
  dusurulen: number;
  guncellenen: number;
}

const parcala = <T>(d: T[], n: number): T[][] => {
  const c: T[][] = [];
  for (let i = 0; i < d.length; i += n) c.push(d.slice(i, i + n));
  return c;
};

const tarih = (v: unknown): Date | null => {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Arşivi okuyup bizdeki BM banlarıyla uzlaştırır.
 *
 * `yaz: false` (varsayılan) HİÇBİR ŞEY DEĞİŞTİRMEZ, yalnızca raporlar —
 * CLI'nin `--write` konvansiyonunun aynısı. Düşürme adımı ayrıca
 * `dusurmeKarari`den geçiyor: sayılar makul değilse güncelleme yapılır
 * ama düşürme HİÇ yapılmaz.
 */
export async function uzlastir(
  opts: { db: Db; dir: string },
  secenekler: { yaz?: boolean } = {},
): Promise<UzlastirmaOzeti> {
  const { db, dir } = opts;
  const yaz = secenekler.yaz === true;

  // Arşivdeki banlar: kimlik -> değişebilen alanlar.
  const arsiv = new Map<string, { reason: string; expiresAt: Date | null }>();
  for await (const rec of readNdjson<BmRecord>(path.join(dir, 'bans.ndjson'))) {
    if (!rec.id) continue;
    const a = rec.attributes ?? {};
    arsiv.set(rec.id, {
      reason: String(a.reason ?? '(sebep yok)'),
      expiresAt: tarih(a.expires),
    });
  }

  // Bizdeki BM banları. Aktif olan ve olmayan ayrı ayrı gerekiyor.
  const bizdeki = await db
    .select({
      externalId: moderationSchema.bans.externalId,
      revokedAt: moderationSchema.bans.revokedAt,
    })
    .from(moderationSchema.bans)
    .where(eq(moderationSchema.bans.source, SOURCE));

  const tumu: string[] = [];
  const aktifler: string[] = [];
  for (const b of bizdeki) {
    if (!b.externalId) continue;
    tumu.push(b.externalId);
    if (!b.revokedAt) aktifler.push(b.externalId);
  }

  const fark = uzlastirmaFarki(arsiv.keys(), aktifler, tumu);
  const karar = dusurmeKarari(fark.bizdekiAktif, fark.dusecek.length, fark.arsivdeki);

  let dusurulen = 0;
  let guncellenen = 0;

  if (yaz) {
    // Güncelleme karardan BAĞIMSIZ: sebep/süre tazelemek hiçbir banı
    // kaldırmıyor, en kötü ihtimalle metni düzeltiyor.
    for (const id of fark.guncellenecek) {
      const yeni = arsiv.get(id);
      if (!yeni) continue;
      const sonuc = await db
        .update(moderationSchema.bans)
        .set({ reason: yeni.reason, expiresAt: yeni.expiresAt })
        .where(
          and(eq(moderationSchema.bans.source, SOURCE), eq(moderationSchema.bans.externalId, id)),
        );
      guncellenen += (sonuc as unknown as { rowCount?: number }).rowCount ?? 1;
    }

    if (karar.guvenli && fark.dusecek.length > 0) {
      const simdi = new Date();
      for (const parca of parcala(fark.dusecek, PARCA)) {
        await db
          .update(moderationSchema.bans)
          .set({ revokedAt: simdi })
          .where(
            and(
              eq(moderationSchema.bans.source, SOURCE),
              inArray(moderationSchema.bans.externalId, parca),
              // Yarıştan korunma: bu arada elle kaldırılmış olabilir.
              isNull(moderationSchema.bans.revokedAt),
            ),
          );
        dusurulen += parca.length;
      }
    }
  }

  logger.info(
    {
      arsiv: fark.arsivdeki,
      aktif: fark.bizdekiAktif,
      yeni: fark.yeni.length,
      guncellenecek: fark.guncellenecek.length,
      dusecek: fark.dusecek.length,
      guvenli: karar.guvenli,
      ...(karar.gerekce ? { gerekce: karar.gerekce } : {}),
      yazildi: yaz,
    },
    yaz ? 'uzlaştırma uygulandı' : 'uzlaştırma KURU KOŞU — hiçbir şey değişmedi',
  );

  return { ...fark, karar, yazildi: yaz, dusurulen, guncellenen };
}
