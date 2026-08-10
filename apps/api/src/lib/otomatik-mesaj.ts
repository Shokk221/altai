/**
 * Oyun içi yetkili uyarılarının otomatik mi insan mı olduğunu ayırır.
 *
 * Sunucuda çalışan eklentiler (manga uyarısı, TK özür sistemi, hoş geldin
 * mesajı, klan dengeleme) RCON'a insan yetkiliyle AYNI kanaldan yazıyor:
 * "Remote admin has warned player X". Ayırt edecek bir alan yok — ne
 * gönderen, ne kaynak.
 *
 * Ölçüldü: canlıda bir saatte 454 uyarının 289'u yalnızca üç kalıptan
 * geliyordu ve sistem günlüğünün %65'ini eklenti mesajları kaplıyordu.
 * Gerçek bir moderasyon kararı bu yığının içinde görünmez hâle geliyordu.
 *
 * Kalıpları KODA YAZMIYORUZ. 92 farklı metin vardı ve sunucudaki eklenti
 * yapılandırması bizden bağımsız değişiyor; sabit liste ilk değişiklikte
 * yanlışlar ve kimse fark etmez. Bunun yerine tekrarı ölçüyoruz: bir insan
 * aynı cümleyi saatte üç kez birebir yazmıyor, bir eklenti hep yazıyor.
 *
 * Hiçbir kayıt DÜŞÜRÜLMÜYOR — yalnızca eylem adı ve kırılım değişiyor,
 * böylece "bugün kim ban attı" sorusu eklenti gürültüsüne boğulmuyor ama
 * "sunucu ne diyordu" sorusu da cevapsız kalmıyor.
 */

/** Bu kadar tekrardan SONRA otomatik sayılıyor. */
const TEKRAR_ESIGI = 3;
/** Sayaçların yaşı; bundan eskisi unutuluyor. */
const PENCERE_MS = 60 * 60 * 1000;
/** Farklı metin sayısı üst sınırı — bellek sınırsız büyümesin. */
const TAVAN = 500;

interface Kayit {
  adet: number;
  sonGoruldu: number;
}

const sayaclar = new Map<string, Kayit>();

function anahtar(slug: string, mesaj: string): string {
  // Eklentiler mesaja oyuncu adı ya da süre gömebiliyor ("250 saniyeniz
  // kaldı"); sayılar normalleştirilmezse her tekrar farklı metin sayılır.
  const normal = mesaj.trim().toLowerCase().replace(/\d+/g, '#').slice(0, 120);
  return `${slug}|${normal}`;
}

function temizle(simdi: number) {
  for (const [k, v] of sayaclar) {
    if (simdi - v.sonGoruldu > PENCERE_MS) sayaclar.delete(k);
  }
}

/**
 * Mesajı kaydeder ve otomatik sayılıp sayılmayacağını döndürür.
 *
 * Eşiğe ULAŞAN çağrı da otomatik sayılıyor: kalıbın ilk iki örneği
 * günlükte insan uyarısı olarak kalıyor. Bu bilinçli — yanlış tarafa
 * düşecekse, gürültüyü moderasyon kaydı saymak, gerçek bir kararı
 * gürültü saymaktan iyi.
 */
export function otomatikMi(slug: string, mesaj: string | undefined): boolean {
  if (!mesaj) return false;
  const simdi = Date.now();
  if (sayaclar.size > TAVAN) temizle(simdi);

  const k = anahtar(slug, mesaj);
  const mevcut = sayaclar.get(k);

  if (!mevcut || simdi - mevcut.sonGoruldu > PENCERE_MS) {
    sayaclar.set(k, { adet: 1, sonGoruldu: simdi });
    return false;
  }

  mevcut.adet += 1;
  mevcut.sonGoruldu = simdi;
  return mevcut.adet >= TEKRAR_ESIGI;
}

/** Sadece testler için. */
export function otomatikSayaclariSifirla() {
  sayaclar.clear();
}
