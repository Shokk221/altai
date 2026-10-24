import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { Db } from '../client.js';
import * as accessSchema from '../schema/access.js';

/**
 * Discord üye rolü aynası — `discord_member_roles` yazımı.
 *
 * NEDEN packages/db İÇİNDE: tabloyu iki taraf yazıyor. Bot (rol değişince
 * ve periyodik taramada) ve api (Discord ile girişte — bot kapalı ya da
 * geride olsa bile giren kişinin yetkisi doğru olsun diye). İki ayrı kopya,
 * birinin "rol alındı ama satır silinmedi" hatasını yeniden üretmesi
 * demekti.
 *
 * Yalnızca EŞLENMİŞ roller yazılıyor: sunucudaki renk, bildirim, klan
 * rolleri yetkiyle ilgisiz ve tabloyu şişirirdi.
 */

/** İzlenen roller: yalnızca role_mappings'te tanımlı olanlar. */
export async function eslenmisRolIdleri(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: accessSchema.roleMappings.discordRoleId })
    .from(accessSchema.roleMappings);
  return rows.map((r) => r.id);
}

/**
 * Bir üyenin rollerini eşitler: taşıdığı izlenen rolleri yazar, artık
 * taşımadıklarını siler.
 *
 * `tumRolIdleri` üyenin Discord'daki BÜTÜN rolleri olabilir; izlenmeyenler
 * burada eleniyor. Ekleme ve silme tek transaction'da: yarıda kalırsa üye
 * ne fazla ne eksik yetkili kalsın.
 *
 * Silme izlenen rollerle sınırlı: eşlemesi kaldırılmış bir rolün
 * kayıtlarına dokunulmuyor ki rol yeniden eşlendiğinde veri geri gelsin.
 */
export async function uyeRolleriniYaz(
  db: Db,
  discordId: string,
  tumRolIdleri: readonly string[],
  izlenenListe?: readonly string[],
): Promise<void> {
  const izlenen = izlenenListe ?? (await eslenmisRolIdleri(db));
  if (izlenen.length === 0) return;

  const izlenenKume = new Set(izlenen);
  const roller = [...new Set(tumRolIdleri)].filter((id) => izlenenKume.has(id));
  const simdi = new Date();

  await db.transaction(async (tx) => {
    if (roller.length > 0) {
      await tx
        .insert(accessSchema.discordMemberRoles)
        .values(roller.map((discordRoleId) => ({ discordId, discordRoleId, syncedAt: simdi })))
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

    await tx.delete(accessSchema.discordMemberRoles).where(
      and(
        eq(accessSchema.discordMemberRoles.discordId, discordId),
        inArray(accessSchema.discordMemberRoles.discordRoleId, [...izlenen]),
        // Üyede hiç izlenen rol kalmadıysa hepsi gider.
        roller.length > 0
          ? notInArray(accessSchema.discordMemberRoles.discordRoleId, roller)
          : undefined,
      ),
    );
  });
}
