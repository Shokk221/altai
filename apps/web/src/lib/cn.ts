/**
 * Sınıf birleştirici.
 *
 * clsx/tailwind-merge yerine elle: bu kadarına ihtiyacımız var ve plan
 * "dış bağımlılık minimum" diyor. Çakışan Tailwind sınıflarını çözmüyor —
 * bileşenlerde varsayılanları `className` ile EZMEK yerine varyantlarla
 * yönetiyoruz, o yüzden gerekmiyor.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
