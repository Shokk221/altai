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

import { type YaptirimKipi, banAktifMi } from './ban-active.js';

export interface BanListEntry {
  steamId: string | null;
  eosId: string | null;
  reason: string;
  /** null = kalıcı ban */
  expiresAt: Date | null;
}

const MAX_REASON_LENGTH = 180;

/**
 * BM'nin sebep metinlerinde şablon yer tutucuları var ({{expires}} gibi).
 * Bunlar BM tarafında dolduruluyordu; ham bırakırsak oyuncu ban ekranında
 * literal "{{expires}}" görür.
 */
export function renderReason(reason: string, expiresAt: Date | null, now: Date): string {
  const expiryText = expiresAt ? expiresAt.toISOString().slice(0, 16).replace('T', ' ') : 'kalıcı';
  const leftText = expiresAt ? humanizeDuration(expiresAt.getTime() - now.getTime()) : 'kalıcı';

  const out = reason
    .replaceAll('{{expires}}', expiryText)
    .replaceAll('{{timeLeft}}', leftText)
    // Satır sonu ban listesini bozar: bir sonraki satır geçersiz kayıt olur.
    .replace(/[\r\n]+/g, ' ')
    .trim();

  return out.length > MAX_REASON_LENGTH ? `${out.slice(0, MAX_REASON_LENGTH - 1)}…` : out;
}

function humanizeDuration(ms: number): string {
  if (ms <= 0) return 'süresi doldu';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours} saat`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} gün`;
  return `${Math.floor(days / 30)} ay`;
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
  const header = [
    '//////////////////////////////////////////////////////////////////////',
    '//// Altai v2 — otomatik üretilmiş ban listesi. ELLE DÜZENLEMEYİN. ////',
    ...valfUyarisi,
    `//// ${banCount} tekil ban (${entries.length} kayıttan), ${lines.length} kimlik satırı`,
    '//// Aynı oyuncuya aynı bitiş tarihiyle atılmış banlar tek satıra indi.',
    `//// üretim: ${now.toISOString()}${label ? ` — ${label}` : ''}`,
    '//////////////////////////////////////////////////////////////////////',
  ];

  return `${[...header, ...lines].join('\n')}\n`;
}
