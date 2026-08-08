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
}

export function formatBanList(opts: FormatOptions): string {
  const { entries, now, label } = opts;
  const lines: string[] = [];
  const seen = new Set<string>();
  let banCount = 0;

  for (const entry of entries) {
    // Süresi geçmiş ban listeye girmez. Sorgu bunu zaten filtreliyor ama
    // liste dakikalarca önbelleklenebiliyor; burada da kontrol ediyoruz.
    if (entry.expiresAt && entry.expiresAt.getTime() <= now.getTime()) continue;

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

  const header = [
    '//////////////////////////////////////////////////////////////////////',
    '//// Altai v2 — otomatik üretilmiş ban listesi. ELLE DÜZENLEMEYİN. ////',
    `//// ${banCount} aktif ban, ${lines.length} kimlik satırı`,
    `//// üretim: ${now.toISOString()}${label ? ` — ${label}` : ''}`,
    '//////////////////////////////////////////////////////////////////////',
  ];

  return `${[...header, ...lines].join('\n')}\n`;
}
