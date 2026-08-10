import type { Db } from '@altai/db';
import { accessSchema } from '@altai/db';
import { logger } from '@altai/shared';
import type { GuildMember } from 'discord.js';
import { and, eq, inArray, lt, notInArray } from 'drizzle-orm';

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

/** İzlenecek roller: yalnızca role_mappings'te tanımlı olanlar. */
async function eslenmisRoller(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: accessSchema.roleMappings.discordRoleId })
    .from(accessSchema.roleMappings);
  return rows.map((r) => r.id);
}

/**
 * Tek bir üyenin rollerini eşitler — `guildMemberUpdate` bunu çağırır.
 *
 * Ekleme ve silme tek transaction'da: yarıda kalırsa üye ne fazla ne eksik
 * yetkili kalsın.
 */
export async function uyeyiEsitle(db: Db, member: GuildMember, izlenenListe?: string[]) {
  const izlenen = izlenenListe ?? (await eslenmisRoller(db));
  if (izlenen.length === 0) return;

  const izlenenKume = new Set(izlenen);
  const uyeninRolleri = member.roles.cache.map((r) => r.id).filter((id) => izlenenKume.has(id));
  const simdi = new Date();

  await db.transaction(async (tx) => {
    if (uyeninRolleri.length > 0) {
      await tx
        .insert(accessSchema.discordMemberRoles)
        .values(
          uyeninRolleri.map((discordRoleId) => ({
            discordId: member.id,
            discordRoleId,
            syncedAt: simdi,
          })),
        )
        // Zaten varsa syncedAt tazelensin: admin listesi ucu bu alana bakıp
        // "liste bayat mı" diye karar veriyor.
        .onConflictDoUpdate({
          target: [
            accessSchema.discordMemberRoles.discordId,
            accessSchema.discordMemberRoles.discordRoleId,
          ],
          set: { syncedAt: simdi },
        });
    }

    // Bu üyenin artık taşımadığı İZLENEN roller silinir.
    //
    // Silmeyi izlenen rollerle sınırlıyoruz: eşlemesi kaldırılmış bir rolün
    // kayıtlarına dokunmuyoruz ki o rol yeniden eşlendiğinde veri geri gelsin.
    await tx.delete(accessSchema.discordMemberRoles).where(
      and(
        eq(accessSchema.discordMemberRoles.discordId, member.id),
        inArray(accessSchema.discordMemberRoles.discordRoleId, izlenen),
        // Üyede hiç izlenen rol kalmadıysa hepsi gider.
        uyeninRolleri.length > 0
          ? notInArray(accessSchema.discordMemberRoles.discordRoleId, uyeninRolleri)
          : undefined,
      ),
    );
  });
}

/**
 * Tüm guild'i tarar.
 *
 * Açılışta ve periyodik olarak çalışır. Gerekçesi: bot kapalıyken yapılan
 * rol değişikliklerini `guildMemberUpdate` olayı göremez. Tam tarama olmadan
 * bot her yeniden başladığında veri sessizce bayatlardı.
 */
export async function guildiEsitle(db: Db, uyeler: Map<string, GuildMember>) {
  const izlenen = await eslenmisRoller(db);
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
  const izlenen = await eslenmisRoller(db);
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
