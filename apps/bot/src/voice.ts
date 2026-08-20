import type { Db } from '@altai/db';
import { accessSchema } from '@altai/db';
import { and, eq, notInArray, sql } from 'drizzle-orm';

/**
 * Discord ses durumunun veritabanına yansıtılması.
 *
 * Amaç tek bir soruya cevap verebilmek: "bu oyuncu şu an ses kanalında mı".
 * Yetkili kamerası denetimi buna dayanıyor — kameraya geçen yetkilinin
 * telsizde bulunması bekleniyor, çünkü kamerada gördüğünü kimseye
 * anlatamıyorsa kameranın moderasyon değeri yok.
 *
 * TARİHÇE TUTULMUYOR. Yalnızca o an seste olanların satırı var, ayrılanın
 * satırı siliniyor. Saniyede birkaç kez değişen bir veriyi kalıcı olarak
 * biriktirmek, hiç sorulmayacak bir soruya milyonlarca satır yazmak olurdu.
 *
 * NABIZ ŞART. Bot kapalıyken tablo boş kalır ve bu "kimse seste değil"
 * gibi okunur; ses zorunluluğu uygulayan bir plugin de o anda sunucudaki
 * bütün yetkilileri cezalandırırdı. Nabız sayesinde cevap "seste değil"
 * değil "bilinmiyor" oluyor ve kimse cezalandırılmıyor.
 */

/** Bir kişinin ses durumu — discord.js'ten bağımsız sade şekil. */
export interface SesUyesi {
  discordId: string;
  channelId: string;
  channelName: string | null;
}

/**
 * Tam senkron: guild'deki TÜM ses durumunu tabloya yazar.
 *
 * Açılışta çağrılıyor. Bot kapalıyken olan değişiklikler hiçbir olayla
 * gelmiyor; tabloyu olduğu gibi bırakmak, kapanış anındaki durumu "şu an"
 * diye sunmak olurdu.
 *
 * Silme bu guild'le SINIRLI: başka bir guild'in satırlarına dokunmuyor.
 * Tek guild'de çalışan bir bot için bugün fark etmiyor ama tabloyu
 * "sahibi olmadığın satırı silme" kuralıyla tutmak, ikinci bir bot
 * eklendiğinde sessizce veri kaybına dönüşecek bir hatayı baştan kesiyor.
 */
export async function sesDurumunuEsitle(
  db: Db,
  guildId: string,
  uyeler: SesUyesi[],
): Promise<{ seste: number }> {
  await db.transaction(async (tx) => {
    const kalanlar = uyeler.map((u) => u.discordId);

    // Önce artık seste olmayanlar siliniyor. Boş listede `notInArray`
    // kullanılamıyor (SQL `in ()` geçersiz), o yüzden ayrı dal.
    if (kalanlar.length === 0) {
      await tx
        .delete(accessSchema.discordVoiceStates)
        .where(eq(accessSchema.discordVoiceStates.guildId, guildId));
    } else {
      await tx
        .delete(accessSchema.discordVoiceStates)
        .where(
          and(
            eq(accessSchema.discordVoiceStates.guildId, guildId),
            notInArray(accessSchema.discordVoiceStates.discordId, kalanlar),
          ),
        );

      await tx
        .insert(accessSchema.discordVoiceStates)
        .values(
          uyeler.map((u) => ({
            discordId: u.discordId,
            guildId,
            channelId: u.channelId,
            channelName: u.channelName,
            updatedAt: new Date(),
          })),
        )
        .onConflictDoUpdate({
          target: accessSchema.discordVoiceStates.discordId,
          set: {
            guildId: sql`excluded.guild_id`,
            channelId: sql`excluded.channel_id`,
            channelName: sql`excluded.channel_name`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
  });

  return { seste: uyeler.length };
}

/**
 * Tek kişinin ses durumu değişti.
 *
 * `kanal` null ise sesten çıkmış demektir ve satır siliniyor. Kanal
 * değişikliği (bir kanaldan diğerine geçiş) tek bir güncellemeye düşüyor —
 * Discord bunu "çık + gir" olarak değil tek olay olarak veriyor.
 */
export async function sesDurumuDegisti(
  db: Db,
  guildId: string,
  discordId: string,
  kanal: { id: string; name: string | null } | null,
): Promise<void> {
  if (!kanal) {
    await db
      .delete(accessSchema.discordVoiceStates)
      .where(eq(accessSchema.discordVoiceStates.discordId, discordId));
    return;
  }

  await db
    .insert(accessSchema.discordVoiceStates)
    .values({
      discordId,
      guildId,
      channelId: kanal.id,
      channelName: kanal.name,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: accessSchema.discordVoiceStates.discordId,
      set: {
        guildId,
        channelId: kanal.id,
        channelName: kanal.name,
        updatedAt: new Date(),
      },
    });
}

/**
 * Canlılık nabzı.
 *
 * Tek satırlık tabloya zaman damgası yazıyor. api bu damgaya bakıp
 * "ses bilgisi güncel mi" kararını veriyor; bayatsa sorguya "bilinmiyor"
 * cevabı dönüyor.
 */
export async function sesNabzi(db: Db): Promise<void> {
  await db
    .insert(accessSchema.discordVoiceSync)
    .values({ id: true, syncedAt: new Date() })
    .onConflictDoUpdate({
      target: accessSchema.discordVoiceSync.id,
      set: { syncedAt: new Date() },
    });
}
