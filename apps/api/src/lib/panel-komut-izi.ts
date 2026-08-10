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
 */

/** Yankının gelmesi için beklenen en uzun süre. RCON turu milisaniyeler. */
const PENCERE_MS = 20_000;
/** İz birikmesin: eşleşmeyen kayıtlar bu sayıdan sonra temizleniyor. */
const TAVAN = 200;

type Islem = 'warn' | 'kick' | 'ban';

const izler = new Map<string, number>();

function anahtar(slug: string, islem: Islem, isim: string): string {
  return `${slug}|${islem}|${isim.trim().toLowerCase()}`;
}

function eskileriAt(simdi: number) {
  for (const [k, t] of izler) {
    if (simdi - t > PENCERE_MS) izler.delete(k);
  }
}

/** Panel komutu gönderdi. İsim bilinmiyorsa iz bırakılmıyor. */
export function panelKomutuIsaretle(slug: string, islem: Islem, isim: string | null) {
  if (!isim) return;
  const simdi = Date.now();
  if (izler.size > TAVAN) eskileriAt(simdi);
  izler.set(anahtar(slug, islem, isim), simdi);
}

/**
 * Oyundan gelen yankı panelin kendi komutu mu? Evetse iz tüketilir —
 * aynı iz ikinci bir yankıyı da bastırmasın.
 */
export function panelKomutuMu(slug: string, islem: Islem, isim: string | null): boolean {
  if (!isim) return false;
  const k = anahtar(slug, islem, isim);
  const t = izler.get(k);
  if (t === undefined) return false;
  izler.delete(k);
  return Date.now() - t <= PENCERE_MS;
}

/** Sadece testler için. */
export function panelKomutIzleriniSifirla() {
  izler.clear();
}
