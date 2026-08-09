import { timingSafeEqual } from 'node:crypto';

/**
 * Sabit zamanlı string karşılaştırması.
 *
 * `a !== b` karşılaştırması ilk farklı karakterde durur; saldırgan yanıt
 * sürelerini ölçerek sırrı karakter karakter çıkarabilir. Sır karşılaştıran
 * her yerde (agent secret, break-glass kullanıcı adı, ban listesi token'ı)
 * bu kullanılmalı.
 *
 * Uzunluk farkı yine sızar — bunu gizlemek için önce sabit uzunluğa
 * özetliyoruz.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Yine de bir karşılaştırma yap ki erken dönüş süre farkı yaratmasın.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
