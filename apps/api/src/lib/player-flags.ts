import type { Db } from '@altai/db';
import { moderationSchema } from '@altai/db';
import { logger } from '@altai/shared';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Otomatik etiket atama/kaldırma.
 *
 * İki yerden kullanılıyor (Steam seviyesi ve CBL itibarı) ve üçüncüsü
 * geleceği belli. Mantığın kendisi kısa ama içindeki kararlar ince:
 * yarış koşulu, kaynak ayrımı, kaldırmanın silme olmaması. Kopyalanınca
 * bu kararların biri bir kopyada düzelip diğerinde kalıyor.
 */

export interface OtomatikEtiket {
  ad: string;
  /** Panelde rozet rengi (hex). */
  renk: string;
  aciklama: string;
}

/**
 * Etiketi bulur, yoksa oluşturur.
 *
 * Yalnızca KENDİ ürettiğimiz (`source='altai'`) etiketlere bakılıyor:
 * BM'den import edilmiş aynı adlı bir etikete atama yapmak, iki sistemin
 * kayıtlarını birbirine karıştırmak olurdu.
 */
export async function flagIdBulVeyaOlustur(db: Db, etiket: OtomatikEtiket): Promise<string | null> {
  const bizimki = and(
    eq(moderationSchema.flags.name, etiket.ad),
    eq(moderationSchema.flags.source, 'altai'),
  );

  const [mevcut] = await db
    .select({ id: moderationSchema.flags.id })
    .from(moderationSchema.flags)
    .where(bizimki)
    .limit(1);
  if (mevcut) return mevcut.id;

  // `onConflictDoNothing` + yeniden okuma: iki oyuncu aynı anda işlenirken
  // SELECT ile INSERT arasına başka bir işlem girebiliyor. Bu GERÇEKTEN
  // yaşandı ve aynı adlı etiket iki kez oluştu. Kısmi tekil indeks
  // (flags_altai_name_idx) çakışmayı engelliyor, burası da çakışmayı
  // hataya dönüştürmeden çözüyor: kaybeden taraf kazananın satırını okur.
  const [olusan] = await db
    .insert(moderationSchema.flags)
    .values({ name: etiket.ad, description: etiket.aciklama, color: etiket.renk })
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
export async function aktifAtamaVarMi(db: Db, playerId: string, flagId: string): Promise<boolean> {
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
 * Etiketi istenen duruma getirir. Değişiklik yaptıysa `true` döner.
 *
 * `olmali=false` etiketi KALDIRIR ama satırı silmez, işaretler: "bu
 * oyuncuda bu etiket ne zaman vardı" sorusu geçmişe dönük
 * cevaplanabilmeli.
 */
export async function etiketiUygula(
  db: Db,
  playerId: string,
  etiket: OtomatikEtiket,
  olmali: boolean,
  ekleyen: string,
): Promise<boolean> {
  const flagId = await flagIdBulVeyaOlustur(db, etiket);
  if (!flagId) return false;

  const mevcut = await aktifAtamaVarMi(db, playerId, flagId);

  if (olmali && !mevcut) {
    await db
      .insert(moderationSchema.flagAssignments)
      .values({ flagId, playerId, addedByName: ekleyen });
    logger.info({ playerId, flag: etiket.ad, ekleyen }, 'otomatik etiket atandı');
    return true;
  }

  if (!olmali && mevcut) {
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
    logger.info({ playerId, flag: etiket.ad, ekleyen }, 'otomatik etiket kaldırıldı');
    return true;
  }

  return false;
}
