/**
 * Panelde tarih ve süre biçimlendirme.
 *
 * Hepsi tek yerde çünkü moderasyon ekranında tutarsız zaman gösterimi
 * gerçek bir hataya yol açıyor: "3 gün önce" ile "07.08" karışınca banın ne
 * zaman dolduğu yanlış okunuyor.
 */

const TARIH = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
});

const TARIH_SAAT = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function tarih(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? '—' : TARIH.format(d);
}

export function tarihSaat(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? '—' : TARIH_SAAT.format(d);
}

/** Saniyeyi "142 sa 30 dk" gibi okunur süreye çevirir. */
export function sure(saniye: number): string {
  if (!Number.isFinite(saniye) || saniye <= 0) return '—';
  const saat = Math.floor(saniye / 3600);
  const dakika = Math.floor((saniye % 3600) / 60);
  if (saat === 0) return `${dakika} dk`;
  if (saat < 100) return `${saat} sa ${dakika} dk`;
  // Yüzlerce saatte dakika gürültü; okunurluk için düşüyor.
  return `${saat.toLocaleString('tr-TR')} sa`;
}

export function sayi(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('tr-TR') : '—';
}

/** "kalıcı" ya da bitiş tarihi — ban rozetlerinde kullanılıyor. */
export function banBitis(expiresAt: string | null): string {
  return expiresAt ? tarihSaat(expiresAt) : 'kalıcı';
}

const GUN_SAAT = new Intl.DateTimeFormat('tr-TR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Sohbet satırları için kısa damga: "09.08 22:41".
 * Yıl yok — sohbet okunurken gün ve saat yeterli, yıl satırı uzatıyor.
 */
export function saatDakika(v: string | Date | null | undefined): string {
  if (!v) return '—';
  const d = typeof v === 'string' ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? '—' : GUN_SAAT.format(d);
}

function insanSure(ms: number): string {
  if (ms <= 0) return 'süresi doldu';
  const saat = Math.floor(ms / 3_600_000);
  if (saat < 24) return `${saat} saat`;
  const gun = Math.floor(saat / 24);
  if (gun < 30) return `${gun} gün`;
  return `${Math.floor(gun / 30)} ay`;
}

/**
 * Ban sebebindeki şablon yer tutucularını doldurur.
 *
 * Eski sistemden gelen sebepler `{{expires}}` ve `{{timeLeft}}` içeriyor;
 * bunlar ban listesi üretilirken dolduruluyordu ama panelde ham hâlde
 * görünüyordu — admin ekranda "{{timeLeft}}" okuyordu.
 */
export function banSebebi(reason: string, expiresAt: string | null): string {
  const bitis = expiresAt ? new Date(expiresAt) : null;
  const bitisMetni = bitis ? tarihSaat(bitis) : 'kalıcı';
  const kalanMetni = bitis ? insanSure(bitis.getTime() - Date.now()) : 'kalıcı';
  return reason
    .replaceAll('{{expires}}', bitisMetni)
    .replaceAll('{{timeLeft}}', kalanMetni)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const BIRIMLER: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

const GORELI = new Intl.RelativeTimeFormat('tr-TR', { numeric: 'auto' });

/**
 * "5 yıl önce", "6 gün önce".
 *
 * Mutlak tarihin YANINDA gösteriliyor, yerine değil: "23.03.2023" ne kadar
 * eski olduğunu hemen söylemiyor, "3 yıl önce" hangi gün olduğunu
 * söylemiyor. Moderasyonda ikisi de gerekiyor.
 */
export function gecenSure(v: string | Date | null | undefined): string {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : v;
  if (Number.isNaN(d.getTime())) return '';
  const fark = d.getTime() - Date.now();
  const mutlak = Math.abs(fark);
  for (const [birim, ms] of BIRIMLER) {
    if (mutlak >= ms) return GORELI.format(Math.round(fark / ms), birim);
  }
  return 'az önce';
}
