import { logger } from '@altai/shared';

/**
 * Discord sunucusundaki roller — yetki ekranında seçilebilsin diye.
 *
 * Önce eşleme formunda rol KİMLİĞİ elle yazılıyordu: kimliği bulmak için
 * Discord'da geliştirici modunu açıp role sağ tıklamak gerekiyordu ve
 * listede yalnızca 17 haneli sayılar görünüyordu — hangi satırın "Admin"
 * olduğunu ezbere bilmek gerekiyordu.
 *
 * Kaynak Discord'un kendisi (bot token ile). Veritabanına yazılmıyor: rol
 * adı ve rengi yalnızca ekranda lazım ve Discord'da değiştiğinde ikinci bir
 * kopyanın bayatlaması, hiç tutulmamasından kötü olurdu.
 */

export interface DiscordRol {
  id: string;
  name: string;
  /** `#rrggbb`; renksiz rol (Discord'da 0) null. */
  color: string | null;
  /** Discord'daki sıra — büyük olan üstte. */
  position: number;
}

/** Discord API'nin döndürdüğü biçimin kullandığımız kısmı. */
export interface DiscordApiRol {
  id: string;
  name: string;
  color: number;
  position: number;
  managed: boolean;
}

/**
 * Ham listeyi ekrana hazırlar.
 *
 * Elenenler:
 *  - @everyone (kimliği sunucu kimliğiyle aynı): herkeste var, ona yetki
 *    vermek sunucudaki herkese yetki vermek olurdu.
 *  - Yönetilen roller (bot ve entegrasyon rolleri, "Server Booster"):
 *    Discord bunları elle kimseye verdirmiyor, eşlemenin anlamı yok.
 *
 * Sıra Discord'daki gibi: en yetkili rol en üstte.
 */
export function rolleriDuzenle(ham: readonly DiscordApiRol[], guildId: string): DiscordRol[] {
  return ham
    .filter((r) => r.id !== guildId && !r.managed)
    .sort((a, b) => b.position - a.position)
    .map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null,
      position: r.position,
    }));
}

/**
 * Kısa önbellek: yetki ekranı açıldıkça Discord'a gitmeyelim (hız sınırı),
 * ama Discord'da yeni açılan bir rol de bir dakikadan uzun gizli kalmasın.
 */
const ONBELLEK_MS = 60_000;
let onbellek: { zaman: number; roller: DiscordRol[] } | null = null;

export type RolSonucu = { roller: DiscordRol[] } | { hata: 'yapilandirilmamis' | 'discord_hatasi' };

export async function discordRolleri(botToken: string, guildId: string): Promise<RolSonucu> {
  if (!botToken || !guildId) return { hata: 'yapilandirilmamis' };
  if (onbellek && Date.now() - onbellek.zaman < ONBELLEK_MS) return { roller: onbellek.roller };

  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}/roles`, {
      headers: { Authorization: `Bot ${botToken}` },
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Discord rolleri okunamadı');
      return { hata: 'discord_hatasi' };
    }
    const roller = rolleriDuzenle((await res.json()) as DiscordApiRol[], guildId);
    onbellek = { zaman: Date.now(), roller };
    return { roller };
  } catch (err) {
    logger.warn({ err }, 'Discord rolleri okunamadı');
    return { hata: 'discord_hatasi' };
  }
}
