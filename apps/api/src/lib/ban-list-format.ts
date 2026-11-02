/**
 * Squad remote ban list biçimi.
 *
 * Format sunucudaki RemoteBanListHosts.cfg başlığından birebir alındı:
 *   <id>:<unban zaman damgası> //Sebep
 *
 * Canlı sunucunun Bans.cfg'sinde kimlikler SteamID değil EOS ID olarak
 * duruyor (32 hex). Squad ikisini de tanıdığı için, elimizde varsa HER İKİ
 * satırı da yazıyoruz — bir oyuncunun EOS'u değişmiş ya da arşivde eksikse
 * ban yine tutar. Fazladan satırın maliyeti yok (20 bin ban ~2 MB).
 */

import { renderReason } from '@altai/shared';
import { type YaptirimKipi, banAktifMi } from './ban-active.js';

// Kural `@altai/shared` içinde: aynı metni gönderen dört yol var (ban
// listesi, periyodik kick, anlık kick, Discord kanıt gönderisi) ve
// dördüncüsü apps/api dışında. Buradan yeniden dışa açılıyor ki mevcut
// çağıranlar (ban-enforcer, routes/moderation) değişmesin.
export { renderReason };

export interface BanListEntry {
  steamId: string | null;
  eosId: string | null;
  reason: string;
  /** null = kalıcı ban */
  expiresAt: Date | null;
}

export interface FormatOptions {
  entries: BanListEntry[];
  now: Date;
  /** Başlık yorumunda görünür; hangi sunucu için üretildiği belli olsun. */
  label?: string;
  /**
   * Yaptırım kipi — listeyi DEĞİŞTİRMEZ, yalnızca başlıkta uyarı yazar.
   *
   * Hangi banların sunulduğunu SQL belirliyor (bkz. routes/ban-list.ts →
   * yaptirimKaynakKosulu). Burada durmasının sebebi şu: `altai` kipinde
   * liste yalnızca panel banlarını içeriyor ve bugün panel banı neredeyse
   * yok — yani dosya neredeyse BOŞ geliyor. Boş bir ban listesi, "ban yok"
   * ile "liste süzülmüş" arasındaki farkı dosyaya bakan birine
   * söylemiyor. Oyun sunucusunu bu uca çeviren kişi, 20 binden fazla
   * arşiv banının neden içinde olmadığını dosyanın kendisinden
   * okuyabilmeli.
   */
  kip?: YaptirimKipi;
}

export function formatBanList(opts: FormatOptions): string {
  const { entries, now, label, kip } = opts;
  const lines: string[] = [];
  const seen = new Set<string>();
  let banCount = 0;

  for (const entry of entries) {
    // Süresi geçmiş ban listeye girmez. Sorgu bunu zaten filtreliyor ama
    // liste dakikalarca önbelleklenebiliyor; burada da kontrol ediyoruz.
    // Kural tek yerde: lib/ban-active.ts.
    if (!banAktifMi({ revokedAt: null, expiresAt: entry.expiresAt }, now)) continue;

    const timestamp = entry.expiresAt ? Math.floor(entry.expiresAt.getTime() / 1000) : 0;
    const reason = renderReason(entry.reason, entry.expiresAt, now);

    let wrote = false;
    for (const id of [entry.eosId, entry.steamId]) {
      if (!id) continue;
      const key = `${id}:${timestamp}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(`${id}:${timestamp} //${reason}`);
      wrote = true;
    }
    if (wrote) banCount++;
  }

  // `altai` kipinde liste SÜZÜLMÜŞ: boşluğu "ban yok" sanmak, arşivdeki
  // yirmi binden fazla banın sessizce uygulanmamasına yol açar.
  const valfUyarisi =
    kip === 'altai'
      ? [
          '//// DİKKAT — yaptırım kipi: altai. Bu liste YALNIZCA panelden',
          '//// atılan banları içeriyor. BattleMetrics arşivinden gelen',
          '//// banlar burada YOK; onları hâlâ ESKİ sistem uyguluyor.',
          '//// Oyun sunucusunu bu listeye çevirmeden önce arşivin',
          '//// tazelenmesi ve BAN_ENFORCEMENT kararı gözden geçirilmeli.',
        ]
      : [];

  // Girdi ile çıktı arasındaki fark bilinçli ve açıkça yazılıyor: BM verisinde
  // aynı oyuncuya aynı bitiş tarihiyle defalarca ban atılmış kayıtlar var
  // (otomatik TK banları). Oyun için etkileri aynı olduğundan tek satıra
  // indiriyoruz. Bunu yazmazsak, panelde 21 bin ban görüp listede 11 bin
  // satır sayan biri veri kaybı sanır.
  /**
   * YORUM BLOĞU LİSTENİN SONUNDA — bilinçli.
   *
   * Canlıda gerçekten uygulanan iki ban listesini okudum: oyun sunucusunun
   * çektiği eski sistem listesi (3971 satır) ve OWI'nin global listesi.
   * İKİSİNDE DE tek bir yorum ya da boş satır yok, baştan sona
   * `<id>:<ts> //sebep`. Yani "satır başında // olur" varsayımının canlıda
   * hiçbir örneği yok.
   *
   * Squad'ın ayrıştırıcısının tek başına duran bir `//` satırında ne yaptığı
   * doğrulanmadı ve yanlışının bedeli sessiz: ilk bozuk satırda duruyorsa
   * blok en üstteyken liste KOMPLE boşa düşer, bunu ne oyun günlüğü ne panel
   * söyler. Blok en sonda olunca en kötü durumda bile ban satırlarının
   * tamamı okunmuş olur; en iyi durumda hiçbir şey değişmez.
   */
  const altbilgi = [
    '//////////////////////////////////////////////////////////////////////',
    '//// Altai v2 — otomatik üretilmiş ban listesi. ELLE DÜZENLEMEYİN. ////',
    ...valfUyarisi,
    `//// ${banCount} tekil ban (${entries.length} kayıttan), ${lines.length} kimlik satırı`,
    '//// Aynı oyuncuya aynı bitiş tarihiyle atılmış banlar tek satıra indi.',
    `//// üretim: ${now.toISOString()}${label ? ` — ${label}` : ''}`,
    '//////////////////////////////////////////////////////////////////////',
  ];

  return `${[...lines, ...altbilgi].join('\n')}\n`;
}
