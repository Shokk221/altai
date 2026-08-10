/**
 * Canlı sohbet yayını.
 *
 * Mesajlar zaten veritabanına yazılıyor ama panele akmıyordu: bir mesajı
 * görmek için sayfayı yenilemek gerekiyordu. Moderasyonun canlı ekranı,
 * olan biteni gecikmesiz göstermeli.
 *
 * Halka tampon (ring buffer) bellekte: yeni bağlanan tarayıcı son
 * mesajları hemen görsün diye. Kalıcı kayıt veritabanında; burası yalnızca
 * "son birkaç dakika" penceresi. api yeniden başlarsa tampon boşalır ve
 * ilk mesajlarla yeniden dolar — kayıp yok, çünkü asıl kayıt zaten yazıldı.
 */

export interface CanliMesaj {
  serverSlug: string;
  steamId: string;
  name: string | null;
  channel: string;
  message: string;
  timestamp: string;
}

/**
 * Tampon boyutu. Dolu bir sunucuda dakikada ~20 mesaj geliyor; 200 satır
 * yaklaşık on dakikalık pencere demek — yeni açılan ekranın bağlamı
 * yakalamasına yetiyor, belleği de meşgul etmiyor.
 */
const TAMPON = 200;

const halka: CanliMesaj[] = [];
type Dinleyici = (mesaj: CanliMesaj) => void;
const dinleyiciler = new Set<Dinleyici>();

export function sohbetYayinla(mesaj: CanliMesaj) {
  halka.push(mesaj);
  if (halka.length > TAMPON) halka.shift();
  for (const d of dinleyiciler) d(mesaj);
}

export function sonMesajlar(): CanliMesaj[] {
  return [...halka];
}

export function sohbetDinle(d: Dinleyici): () => void {
  dinleyiciler.add(d);
  return () => dinleyiciler.delete(d);
}
