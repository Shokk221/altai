import type { Db } from '@altai/db';
import { accessSchema, eslenmisRolIdleri, uyeRolleriniYaz } from '@altai/db';
import { logger } from '@altai/shared';
import type { GuildMember } from 'discord.js';
import { and, eq, inArray, lt } from 'drizzle-orm';

/**
 * Discord rol senkronu — yetki zincirinin son halkası.
 *
 * `discord_member_roles` tablosu Discord'un AYNASIDIR: hangi hesapta hangi
 * rol var. Admins.cfg bu tablodan üretiliyor, dolayısıyla Discord'da rol
 * alınınca oyun içi yetki de düşüyor.
 *
 * Yalnızca EŞLENMİŞ roller yazılıyor. Sunucuda yüzlerce rol olabilir (renk,
 * bildirim, klan rolleri...) ve hepsini kaydetmek tabloyu yetkiyle ilgisi
 * olmayan satırlarla şişirirdi.
 *
 * Silme mantığı en kritik parça: bir üyenin rolü kaldırıldığında satırın
 * GİTMESİ gerekiyor. Yalnızca ekleme yapan bir senkron "rol alındı ama yetki
 * düşmedi" durumunu üretir — tam da eski sistemin sorunuydu.
 */

/**
 * Tek bir üyenin rollerini eşitler — `guildMemberUpdate` bunu çağırır.
 *
 * Kuralın kendisi packages/db'de (`uyeRolleriniYaz`): api de girişte aynı
 * tabloyu yazıyor ve iki kopyanın ayrışmaması gerekiyor.
 */
export async function uyeyiEsitle(db: Db, member: GuildMember, izlenenListe?: string[]) {
  await uyeRolleriniYaz(
    db,
    member.id,
    member.roles.cache.map((r) => r.id),
    izlenenListe,
  );
}

/**
 * Tüm guild'i tarar.
 *
 * Açılışta ve periyodik olarak çalışır. Gerekçesi: bot kapalıyken yapılan
 * rol değişikliklerini `guildMemberUpdate` olayı göremez. Tam tarama olmadan
 * bot her yeniden başladığında veri sessizce bayatlardı.
 */
export async function guildiEsitle(db: Db, uyeler: Map<string, GuildMember>) {
  const izlenen = await eslenmisRolIdleri(db);
  if (izlenen.length === 0) {
    logger.warn('role_mappings boş — senkronlanacak rol yok, tarama atlandı');
    return { uye: 0, kayit: 0, silinen: 0 };
  }

  const izlenenKume = new Set(izlenen);
  const simdi = new Date();
  const satirlar: { discordId: string; discordRoleId: string; syncedAt: Date }[] = [];

  for (const [, member] of uyeler) {
    for (const [, rol] of member.roles.cache) {
      if (izlenenKume.has(rol.id)) {
        satirlar.push({ discordId: member.id, discordRoleId: rol.id, syncedAt: simdi });
      }
    }
  }

  let silinen = 0;
  await db.transaction(async (tx) => {
    if (satirlar.length > 0) {
      await tx
        .insert(accessSchema.discordMemberRoles)
        .values(satirlar)
        .onConflictDoUpdate({
          target: [
            accessSchema.discordMemberRoles.discordId,
            accessSchema.discordMemberRoles.discordRoleId,
          ],
          set: { syncedAt: simdi },
        });
    }

    // Bu turda dokunulmayan satırlar artık geçerli değil: ya rol alınmış ya
    // üye sunucudan ayrılmış. Damgası bu turdan ESKİ olanları siliyoruz —
    // binlerce kimliği tek tek sorguya koymak yerine tek karşılaştırma.
    const eskiler = await tx
      .delete(accessSchema.discordMemberRoles)
      .where(
        and(
          inArray(accessSchema.discordMemberRoles.discordRoleId, izlenen),
          lt(accessSchema.discordMemberRoles.syncedAt, simdi),
        ),
      )
      .returning({ id: accessSchema.discordMemberRoles.id });
    silinen = eskiler.length;
  });

  return { uye: uyeler.size, kayit: satirlar.length, silinen };
}

/**
 * Sunucudan ayrılan üyenin kayıtlarını siler.
 *
 * Ayrı fonksiyon: `uyeyiEsitle`'ye boş rollü sahte bir üye nesnesi uydurmak
 * yerine niyeti doğrudan ifade ediyor. Ayrılan biri Admins.cfg'de kalmamalı.
 */
export async function uyeyiTemizle(db: Db, discordId: string) {
  const izlenen = await eslenmisRolIdleri(db);
  if (izlenen.length === 0) return;
  await db
    .delete(accessSchema.discordMemberRoles)
    .where(
      and(
        eq(accessSchema.discordMemberRoles.discordId, discordId),
        inArray(accessSchema.discordMemberRoles.discordRoleId, izlenen),
      ),
    );
}
