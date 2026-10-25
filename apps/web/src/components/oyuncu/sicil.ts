import type { Profil } from '@/components/oyuncu/tipler';

/**
 * Sayfanın ilk okunan cümlesi — sicilin o anki özeti.
 *
 * Başlığın altında duruyor ve moderatörün "ne yapmalıyım" sorusuna ilk
 * cevabı veriyor. VERİDEN hesaplanıyor; sabit bir açıklama değil.
 *
 * Önce burada arayüzü anlatan bir şey yoktu, hiçbir şey yoktu: isim ve
 * rozetlerin altında doğrudan dokuz istatistik başlıyordu. Banlı bir
 * oyuncuyla temiz bir oyuncuyu ayırt etmek için küçük kırmızı rozeti
 * fark etmek gerekiyordu.
 *
 * Ton da veriden: aktif ban kırmızı, açık uyarı/takip sarı, temiz sicil
 * nötr. Renk burada KARAR bildiriyor, süs değil.
 */
export function sicilOzeti(profil: Profil): { metin: string; ton: 'danger' | 'warn' | 'sakin' } {
  const aktifBan = profil.bans.find((b) => b.active);
  const acikKayit = profil.records.filter((k) => !k.resolvedAt);
  const acikUyari = acikKayit.filter((k) => k.kind === 'warning').length;
  const takip = acikKayit.filter((k) => k.kind === 'watchlist').length;
  const gecmisBan = profil.bans.filter((b) => !b.active).length;

  if (aktifBan) {
    const sure = aktifBan.expiresAt ? 'süreli' : 'kalıcı';
    const oncesi = gecmisBan > 0 ? ` Bundan önce ${gecmisBan} banı daha var.` : ' İlk banı.';
    return { metin: `Şu anda ${sure} banlı.${oncesi}`, ton: 'danger' };
  }

  if (takip > 0) {
    return {
      metin: `Banlı değil ama takipte: ${takip} açık takip kaydı var${acikUyari > 0 ? `, ${acikUyari} açık uyarı` : ''}.`,
      ton: 'warn',
    };
  }

  if (acikUyari > 0) {
    return {
      metin: `Banlı değil. ${acikUyari} açık uyarısı var${gecmisBan > 0 ? ` ve geçmişte ${gecmisBan} ban almış` : ''}.`,
      ton: 'warn',
    };
  }

  if (gecmisBan > 0) {
    return { metin: `Şu anda temiz. Geçmişte ${gecmisBan} ban almış.`, ton: 'sakin' };
  }

  return { metin: 'Sicili temiz: ban ya da açık kayıt yok.', ton: 'sakin' };
}
