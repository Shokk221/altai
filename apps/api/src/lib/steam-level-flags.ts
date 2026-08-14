import type { Db } from '@altai/db';
import { identitySchema, moderationSchema } from '@altai/db';
import { logger } from '@altai/shared';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Steam seviyesine göre etiketleme.
 *
 * İstek: "3lv altı Steam hesapları kırmızı, 5lv altı sarı olacak şekilde bir
 * flag sistemi." Eski sistemde bu BattleMetrics flag'leriyle yapılacaktı;
 * bizim `flags` tablomuz aynı işi görüyor ve rozetin rengi zaten orada.
 *
 * Karar burada, agent'ta değil. Eşik değiştiğinde (bugün 3, yarın 4) oyun
 * sunucusundaki hiçbir dosyaya dokunmak gerekmiyor; etiketin adı ve rengi
 * de veritabanı satırı olduğu için panelden değiştirilebiliyor.
 *
 * ÜÇ DURUM VAR, ÜÇÜ DE FARKLI:
 *  - seviye okundu ve düşük  -> etiket atanır
 *  - seviye okundu ve yeterli -> varsa etiket KALDIRILIR (hesap büyümüş
 *    olabilir; damganın kalıcı olması yanlış olurdu)
 *  - seviye okunamadı (gizli profil) -> hiçbir şey yapılmaz. Profilini
 *    kapatmak kural ihlali değil ve "okunamadı"yı "seviye 0" saymak
 *    herkesi en düşük seviyeymiş gibi damgalardı.
 */

export interface SeviyeEsigi {
  /** Bu seviyenin ALTINDA olanlar bu etiketi alır. */
  altinda: number;
  flagAdi: string;
  /** Panelde rozet rengi (hex). */
  renk: string;
  aciklama: string;
}

/**
 * Eşikler SIRALI: ilk eşleşen kazanır, o yüzden en dar olan başta.
 * 3'ün altındaki bir hesap 5'in de altında; ikisini birden almamalı.
 */
export const VARSAYILAN_ESIKLER: SeviyeEsigi[] = [
  {
    altinda: 3,
    flagAdi: 'Steam Seviyesi < 3',
    renk: '#dc2626',
    aciklama: 'Steam hesap seviyesi 3’ün altında — yeni ya da tek kullanımlık hesap olabilir.',
  },
  {
    altinda: 5,
    flagAdi: 'Steam Seviyesi < 5',
    renk: '#f59e0b',
    aciklama: 'Steam hesap seviyesi 5’in altında.',
  },
];

/** Etiketi bulur, yoksa oluşturur. */
async function flagIdBulVeyaOlustur(db: Db, esik: SeviyeEsigi): Promise<string | null> {
  // Yalnızca KENDİ ürettiğimiz etiketlere bakılıyor: BM'den import edilmiş
  // aynı adlı bir etiket varsa ona atama yapmak, iki sistemin kayıtlarını
  // birbirine karıştırmak olurdu.
  const bizimki = and(
    eq(moderationSchema.flags.name, esik.flagAdi),
    eq(moderationSchema.flags.source, 'altai'),
  );

  const [mevcut] = await db
    .select({ id: moderationSchema.flags.id })
    .from(moderationSchema.flags)
    .where(bizimki)
    .limit(1);
  if (mevcut) return mevcut.id;

  // `onConflictDoNothing` + yeniden okuma: iki oyuncu aynı anda işlenirken
  // SELECT ile INSERT arasına başka bir işlem girebiliyor. Tekil indeks
  // (flags_name_idx) çakışmayı ENGELLİYOR, burası da o çakışmayı hataya
  // dönüştürmeden çözüyor — kaybeden taraf kazananın satırını okuyor.
  const [olusan] = await db
    .insert(moderationSchema.flags)
    .values({
      name: esik.flagAdi,
      description: esik.aciklama,
      color: esik.renk,
    })
    .onConflictDoNothing()
    .returning({ id: moderationSchema.flags.id });
  if (olusan) return olusan.id;

  const [yaris] = await db
    .select({ id: moderationSchema.flags.id })
    .from(moderationSchema.flags)
    .where(bizimki)
    .limit(1);
  return yaris?.id ?? null;
}

/** Oyuncuda bu etiket şu an aktif mi? */
async function aktifAtamaVarMi(db: Db, playerId: string, flagId: string): Promise<boolean> {
  const [satir] = await db
    .select({ id: moderationSchema.flagAssignments.id })
    .from(moderationSchema.flagAssignments)
    .where(
      and(
        eq(moderationSchema.flagAssignments.playerId, playerId),
        eq(moderationSchema.flagAssignments.flagId, flagId),
        isNull(moderationSchema.flagAssignments.removedAt),
      ),
    )
    .limit(1);
  return Boolean(satir);
}

/**
 * Seviyeyi kaydeder ve etiketleri güncel duruma getirir.
 *
 * Hiçbir durumda throw etmez: bu bir olay işleyicisinden çağrılıyor ve
 * başarısız olması olay akışını durdurmamalı.
 */
export async function steamSeviyesiniIsle(
  db: Db,
  playerId: string,
  level: number | null,
  gizli: boolean,
  esikler: SeviyeEsigi[] = VARSAYILAN_ESIKLER,
): Promise<void> {
  try {
    // Kayıt her hâlükârda güncelleniyor — gizli profilin de "ne zaman
    // denendi"si tutulmalı, yoksa her girişte tekrar denenir.
    await db
      .insert(identitySchema.steamProfiles)
      .values({ playerId, level, private: gizli, checkedAt: new Date() })
      .onConflictDoUpdate({
        target: identitySchema.steamProfiles.playerId,
        set: { level, private: gizli, checkedAt: new Date() },
      });

    // Seviye okunamadıysa etiketlere DOKUNULMUYOR: ne yeni etiket, ne de
    // eskisinin kaldırılması. Bilmediğimiz bir şeye göre karar vermiyoruz.
    if (level === null) return;

    // Sıralı eşikler: ilk eşleşen kazanır (bkz. VARSAYILAN_ESIKLER).
    const hakEdilen = esikler.find((e) => level < e.altinda) ?? null;

    for (const esik of esikler) {
      const flagId = await flagIdBulVeyaOlustur(db, esik);
      if (!flagId) continue;

      const olmali = hakEdilen?.flagAdi === esik.flagAdi;
      const var_ = await aktifAtamaVarMi(db, playerId, flagId);

      if (olmali && !var_) {
        await db.insert(moderationSchema.flagAssignments).values({
          flagId,
          playerId,
          addedByName: 'steam-level',
        });
        logger.info({ playerId, level, flag: esik.flagAdi }, 'Steam seviye etiketi atandı');
      } else if (!olmali && var_) {
        // Kaldırma SİLME değil işaretleme: "bu oyuncuda ne zaman bu etiket
        // vardı" sorusu geçmişe dönük cevaplanabilmeli.
        await db
          .update(moderationSchema.flagAssignments)
          .set({ removedAt: new Date() })
          .where(
            and(
              eq(moderationSchema.flagAssignments.playerId, playerId),
              eq(moderationSchema.flagAssignments.flagId, flagId),
              isNull(moderationSchema.flagAssignments.removedAt),
            ),
          );
        logger.info({ playerId, level, flag: esik.flagAdi }, 'Steam seviye etiketi kaldırıldı');
      }
    }
  } catch (err) {
    logger.error({ err, playerId, level }, 'Steam seviyesi işlenemedi');
  }
}

/**
 * Seviyeye hangi etiketin düştüğünü söyler (saf — testlerin baktığı yer).
 *
 * `null` = etiket yok. Seviyenin `null` olması (okunamadı) ile yeterince
 * yüksek olması AYNI sonucu veriyor gibi görünse de çağıran taraf ikisini
 * ayırıyor: okunamayanda mevcut etiketler kaldırılmıyor.
 */
export function seviyeEtiketi(
  level: number | null,
  esikler: SeviyeEsigi[] = VARSAYILAN_ESIKLER,
): string | null {
  if (level === null) return null;
  return esikler.find((e) => level < e.altinda)?.flagAdi ?? null;
}
