import type { AgentEvent } from '@altai/contracts';

/**
 * Olay -> Discord gömü (embed).
 *
 * SAF FONKSİYONLAR: discord.js'e hiç dokunmuyorlar, yalnızca düz nesne
 * üretiyorlar. Sebep test edilebilirlik — "takım öldürmede saldıran ve
 * kurban doğru sırada mı" sorusunun cevabı bir Discord bağlantısı
 * gerektirmemeli. Gönderme işi çağıran tarafta.
 *
 * Plan Bölüm 6'nın kuralının öbür ucu burası: plugin Discord'u bilmiyor,
 * olay üretiyor; bot da oyunu bilmiyor, olayı çiziyor.
 */

export interface Gomu {
  title: string;
  description?: string;
  color: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  timestamp: string;
  footer?: { text: string };
}

/** Bilinmeyen isim yerine kullanılan metin. */
const BILINMEYEN = 'bilinmeyen';

const RENK_TK = 0xdc2626;
const RENK_MAC = 0x2563eb;

/**
 * Takım öldürme kartı.
 *
 * Saldıran ÖNCE yazılıyor ve başlıkta o var: moderatörün aradığı bilgi
 * "kim yaptı". Eski Discord eklentisi kurbanı öne alıyordu ve kartlara
 * bakan kişi sürekli iki ismi karıştırıyordu.
 */
export function teamkillGomusu(event: Extract<AgentEvent, { type: 'TEAMKILL' }>): Gomu {
  const saldiran = event.attackerName?.trim() || BILINMEYEN;
  const kurban = event.victimName?.trim() || BILINMEYEN;

  return {
    title: `Takım öldürme: ${saldiran}`,
    description: `**${saldiran}** → **${kurban}**`,
    color: RENK_TK,
    fields: [
      { name: 'Saldıran', value: kimlikSatiri(event.attackerSteamId, saldiran), inline: true },
      { name: 'Kurban', value: kimlikSatiri(event.victimSteamId, kurban), inline: true },
      // Silah bilinmiyorsa alan HİÇ eklenmiyor: "bilinmeyen" yazan bir
      // alan, kartı okuyan kişiye hiçbir şey söylemiyor ama yer kaplıyor.
      ...(event.weapon?.trim()
        ? [{ name: 'Silah', value: event.weapon.trim(), inline: true }]
        : []),
    ],
    timestamp: event.timestamp,
    footer: { text: event.serverSlug },
  };
}

/** SteamID varsa profil bağlantısı, yoksa yalnızca isim. */
function kimlikSatiri(steamId: string | null | undefined, ad: string): string {
  if (!steamId) return ad;
  return `[${ad}](https://steamcommunity.com/profiles/${steamId})`;
}

/**
 * Maç sonu kartı.
 *
 * Bilet farkı HESAPLANIP yazılıyor: "400-100" satırından farkı zihinde
 * çıkarmak, bir maçın ezici mi yoksa çekişmeli mi geçtiğini anlamayı
 * gereksizce yavaşlatıyor.
 */
export function macSonuGomusu(event: Extract<AgentEvent, { type: 'ROUND_ENDED' }>): Gomu {
  const kazanan =
    event.winnerFaction?.trim() || (event.winnerTeam ? `${event.winnerTeam}. takım` : null);
  const kaybeden = event.loserFaction?.trim() || null;

  const alanlar: Gomu['fields'] = [];
  if (kazanan) alanlar.push({ name: 'Kazanan', value: kazanan, inline: true });
  if (kaybeden) alanlar.push({ name: 'Kaybeden', value: kaybeden, inline: true });

  if (typeof event.winnerTickets === 'number' && typeof event.loserTickets === 'number') {
    const fark = event.winnerTickets - event.loserTickets;
    alanlar.push({
      name: 'Bilet',
      value: `${event.winnerTickets} — ${event.loserTickets} (fark ${fark})`,
      inline: true,
    });
  }

  return {
    title: kazanan ? `Maç bitti — ${kazanan} kazandı` : 'Maç bitti',
    color: RENK_MAC,
    ...(alanlar.length > 0 ? { fields: alanlar } : {}),
    timestamp: event.timestamp,
    footer: { text: event.serverSlug },
  };
}
