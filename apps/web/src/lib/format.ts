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
