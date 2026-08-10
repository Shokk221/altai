/**
 * Canlı olay akışı — panelin ana ekranındaki sağ sütun.
 *
 * Girişler, çıkışlar, manga kurulumları ve sohbet tek bir zaman çizgisinde
 * birleşiyor. Ayrı listeler hâlinde göstermek, "adam girdi, manga kurdu,
 * şunu yazdı" dizisini okunamaz hâle getiriyordu.
 *
 * Halka tampon bellekte: yeni açılan ekran son olayları hemen görsün diye.
 * Kalıcı kayıt veritabanında (chat_messages, game_sessions); burası yalnızca
 * "son yarım saat" penceresi. api yeniden başlarsa tampon boşalır ve yeni
 * olaylarla dolar — kayıp yok, asıl kayıt zaten yazılıyor.
 */

export type OlayTuru = 'join' | 'leave' | 'squad' | 'chat' | 'admin';

export interface CanliOlay {
  id: string;
  tur: OlayTuru;
  serverSlug: string;
  /** Olayın öznesi. Sohbette konuşan, girişte giren kişi. */
  name: string | null;
  steamId: string | null;
  /** Yalnızca sohbet: kanal ve mesaj. */
  channel?: string;
  message?: string;
  /** Yalnızca manga: numara ve ad. */
  squadId?: string;
  squadName?: string;
  /**
   * Yalnızca yetkili işlemi: hangi işlem ve varsa süresi. Metin `message`
   * alanında taşınıyor — sohbetle aynı alan, çünkü ikisi de "şu yazıldı".
   */
  adminIslem?: 'warn' | 'kick' | 'ban' | 'broadcast' | 'cam_enter' | 'cam_exit';
  sure?: string;
  timestamp: string;
}

/**
 * Dolu bir sunucuda dakikada ~30 olay (giriş/çıkış + sohbet) geliyor.
 * 400 satır yaklaşık on beş dakikalık pencere — yeni açılan ekranın bağlamı
 * yakalamasına yetiyor, belleği meşgul etmiyor.
 */
const TAMPON = 400;

const halka: CanliOlay[] = [];
type Dinleyici = (olay: CanliOlay) => void;
const dinleyiciler = new Set<Dinleyici>();

let sayac = 0;

export function olayYayinla(olay: Omit<CanliOlay, 'id'>) {
  // Kimlik istemcide liste anahtarı olarak kullanılıyor; aynı saniyede iki
  // olay olabildiği için zaman damgası tek başına yetmiyor.
  sayac += 1;
  const tam: CanliOlay = { ...olay, id: `${Date.now()}-${sayac}` };
  halka.push(tam);
  if (halka.length > TAMPON) halka.shift();
  for (const d of dinleyiciler) d(tam);
}

export function sonOlaylar(): CanliOlay[] {
  return [...halka];
}

export function olayDinle(d: Dinleyici): () => void {
  dinleyiciler.add(d);
  return () => dinleyiciler.delete(d);
}
