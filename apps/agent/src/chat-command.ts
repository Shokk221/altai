import type { AgentEvent } from '@altai/contracts';

/**
 * Sohbet komutu ayrıştırma.
 *
 * Eski SquadJS her komut için ayrı bir `CHAT_COMMAND:<ad>` olayı yayınlıyordu
 * ve plugin'ler ona abone oluyordu. Bizim olay sözleşmemizde yalnızca
 * `CHAT_MESSAGE` var; komut kavramını sözleşmeye eklemek yerine burada
 * ayrıştırıyoruz.
 *
 * Sebep: "komut" bir OYUN olayı değil, bir yorumlama. Sözleşmeye koysaydık
 * hangi ön ekin komut sayıldığı agent'ın olay üreticisine gömülürdü ve
 * panelden değiştirilemezdi. Burada ise her plugin kendi komutunu kendi
 * ayarından okuyor.
 */

export interface SohbetKomutu {
  /** Komut adı, ön ek ve büyük/küçük harf normalize edilmiş. */
  ad: string;
  /** Komuttan sonraki ham metin (boş olabilir). */
  arguman: string;
  steamId: string;
  channel: 'All' | 'Team' | 'Squad' | 'Admin';
}

/**
 * `!komut argüman` biçimini ayrıştırır. Komut değilse `null`.
 *
 * Ön ek eşleşmesi harf duyarsız ama Türkçe'ye dikkat edilerek yapılıyor:
 * `toLowerCase()` İngilizce kurallarıyla çalıştığı için "KATIL" -> "katil"
 * verir ve `katıl` komutuyla eşleşmez. Bu, komutun bir kısım oyuncuda
 * sessizce çalışmaması demek olurdu.
 */
export function komutAyristir(
  event: Extract<AgentEvent, { type: 'CHAT_MESSAGE' }>,
  onEk = '!',
): SohbetKomutu | null {
  const metin = event.message.trim();
  if (!metin.startsWith(onEk)) return null;

  const govde = metin.slice(onEk.length).trim();
  if (!govde) return null;

  const bosluk = govde.search(/\s/);
  const ad = bosluk === -1 ? govde : govde.slice(0, bosluk);
  const arguman = bosluk === -1 ? '' : govde.slice(bosluk).trim();

  return {
    ad: ad.toLocaleLowerCase('tr-TR'),
    arguman,
    steamId: event.steamId,
    channel: event.channel,
  };
}

/** İki komut adının aynı olup olmadığı (aynı normalleştirme ile). */
export function komutEslesti(gelen: string, beklenen: string): boolean {
  return gelen === beklenen.trim().replace(/^!/, '').toLocaleLowerCase('tr-TR');
}
