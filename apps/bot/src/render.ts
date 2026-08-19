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
const RENK_CAGRI = 0xf59e0b;

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

  // Skorbord varsa ilk üç oyuncu tek alana yazılıyor. Ayrı alan yapmak
  // kartı üç sütuna bölüp maç bilgisini aşağı itiyordu; asıl bilgi maçın
  // kendisi, skorbord ona ek.
  const enIyiler = macinEnIyileri(event.players ?? [], 3);
  if (enIyiler.length > 0) {
    alanlar.push({
      name: 'En çok öldüren',
      value: enIyiler
        .map((p, i) => `${i + 1}. ${p.name?.trim() || BILINMEYEN} — ${p.kills}/${p.deaths}`)
        .join('\n'),
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

/**
 * Skorbordun ilk N'i, öldürmeye göre.
 *
 * Hiç öldürme yapmamış oyuncular ELENİYOR: listeyi doldurmak uğruna sıfır
 * öldürmeli birini "en çok öldüren" başlığı altına koymak, kartı okuyan
 * kişiye yanlış bilgi verirdi. Eşitlikte isme göre sıralanıyor ki aynı maç
 * iki kez çizilse aynı sıra çıksın.
 */
export function macinEnIyileri(
  players: NonNullable<Extract<AgentEvent, { type: 'ROUND_ENDED' }>['players']>,
  n: number,
) {
  return players
    .filter((p) => p.kills > 0)
    .sort((a, b) => b.kills - a.kills || (a.name ?? '').localeCompare(b.name ?? ''))
    .slice(0, n);
}

/**
 * Yetkili çağrısı kartı.
 *
 * Sunucudaki yetkili sayısı ayrı bir alan: "kimse yok" ile "üç kişi var
 * ama bakmıyor" moderatör için çok farklı durumlar ve ikisine verilecek
 * tepki de farklı.
 *
 * Sebep boşsa alan "(belirtilmedi)" ile gösteriliyor, gizlenmiyor: sebebin
 * yokluğu da bilgi — çağrının aceleyle yapıldığını söylüyor.
 */
export function adminCagrisiGomusu(event: Extract<AgentEvent, { type: 'ADMIN_REQUEST' }>): Gomu {
  return {
    title: `Yetkili çağrısı: ${event.playerName}`,
    description: event.reason?.trim() || '_(sebep belirtilmedi)_',
    color: RENK_CAGRI,
    fields: [
      { name: 'Çağıran', value: kimlikSatiri(event.steamId, event.playerName), inline: true },
      {
        name: 'Sunucudaki yetkili',
        value: event.onlineAdmins > 0 ? String(event.onlineAdmins) : 'yok',
        inline: true,
      },
    ],
    timestamp: event.timestamp,
    footer: { text: event.serverSlug },
  };
}
