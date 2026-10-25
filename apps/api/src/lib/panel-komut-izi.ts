/**
 * Panelden gönderilen oyun içi komutların kısa ömürlü izi.
 *
 * Sorun şu: panelden bir oyuncuyu uyardığımızda komut RCON'a gidiyor ve
 * Squad bunu sohbet kanalından "Remote admin has warned player X" diye geri
 * yayınlıyor. Aynı RCON bağlantısını dinlediğimiz için bu yankı bize
 * ADMIN_ACTION olarak dönüyor. Hiçbir şey yapmazsak tek bir uyarı sistem
 * günlüğüne İKİ kez düşerdi: bir kez panelin yazdığı `player.warn`, bir kez
 * oyundan gelen `ingame.warn`.
 *
 * Bu yüzden panel komutu gönderirken iz bırakıyor, yankı geldiğinde iz
 * tüketiliyor ve günlüğe ikinci satır yazılmıyor. Canlı akışta ise yankı
 * GÖSTERİLİYOR — orada anlamı farklı: komutun oyuna gerçekten ulaştığının
 * teyidi.
 *
 * Eşleşme İSİMLE yapılıyor çünkü Squad uyarı yankısında kimlik vermiyor,
 * yalnızca oyuncunun o anki adını yazıyor.
 *
 * Duyuruda (`broadcast`) hedef oyuncu yok; orada anahtar MESAJIN KENDİSİ.
 * Yankı metni birebir gönderdiğimiz metin olduğu için bu güvenilir bir
 * eşleşme ve mekanizmanın geri kalanı aynı kalıyor.
 */

/** Yankının gelmesi için beklenen en uzun süre. RCON turu milisaniyeler. */
const PENCERE_MS = 20_000;
/** İz birikmesin: eşleşmeyen kayıtlar bu sayıdan sonra temizleniyor. */
const TAVAN = 200;

type Islem = 'warn' | 'kick' | 'ban' | 'broadcast';

/**
 * İz artık zamanın yanında SEBEBİ de taşıyor.
 *
 * Sebep buraya konuyor çünkü oyundan geri gelmiyor: Squad'ın kick yanıtı
 * `Kicked player 12. [Online IDs=...] Ad` biçiminde ve sebep alanı YOK
 * (bkz. vendor/squad-server/rcon.js). Yani "neden atıldı" sorusunun
 * cevabı yalnızca komutu GÖNDERENDE var; akışa taşınacaksa buradan
 * taşınmalı. Uyarı ve duyuruda metin yankıda zaten geliyor, orada
 * gerekmiyor.
 */
interface Iz {
  zaman: number;
  sebep?: string;
}

const izler = new Map<string, Iz>();

/**
 * Eşleşme anahtarı: warn/kick/ban'de oyuncunun adı, duyuruda mesaj metni.
 * Uzunluk kırpması duyuru için: Squad yankıda metni olduğu gibi veriyor
 * ama anahtarın sınırsız büyümesine gerek yok.
 */
function anahtar(slug: string, islem: Islem, deger: string): string {
  return `${slug}|${islem}|${deger.trim().toLowerCase().slice(0, 200)}`;
}

function eskileriAt(simdi: number) {
  for (const [k, iz] of izler) {
    if (simdi - iz.zaman > PENCERE_MS) izler.delete(k);
  }
}

/** Panel komutu gönderdi. Anahtar bilinmiyorsa iz bırakılmıyor. */
export function panelKomutuIsaretle(
  slug: string,
  islem: Islem,
  deger: string | null,
  sebep?: string | null,
) {
  if (!deger) return;
  const simdi = Date.now();
  if (izler.size > TAVAN) eskileriAt(simdi);
  const temiz = sebep?.trim();
  izler.set(anahtar(slug, islem, deger), { zaman: simdi, ...(temiz ? { sebep: temiz } : {}) });
}

/**
 * İzdeki sebebi okur — İZİ TÜKETMEDEN.
 *
 * Tüketmemesi şart: çağıran akışa satırı yazdıktan SONRA `panelKomutuMu`
 * ile izi tüketiyor. Burada tüketseydik o kontrol boşa düşer ve panelden
 * gelen her komut sistem günlüğüne ikinci kez yazılırdı — iz
 * mekanizmasının engellemek için var olduğu şey tam olarak bu.
 */
export function panelKomutSebebi(slug: string, islem: Islem, deger: string | null): string | null {
  if (!deger) return null;
  const iz = izler.get(anahtar(slug, islem, deger));
  if (!iz || Date.now() - iz.zaman > PENCERE_MS) return null;
  return iz.sebep ?? null;
}

/**
 * Oyundan gelen yankı panelin kendi komutu mu? Evetse iz tüketilir —
 * aynı iz ikinci bir yankıyı da bastırmasın.
 */
export function panelKomutuMu(slug: string, islem: Islem, deger: string | null): boolean {
  if (!deger) return false;
  const k = anahtar(slug, islem, deger);
  const iz = izler.get(k);
  if (iz === undefined) return false;
  izler.delete(k);
  return Date.now() - iz.zaman <= PENCERE_MS;
}

/** Sadece testler için. */
export function panelKomutIzleriniSifirla() {
  izler.clear();
}
