/**
 * Eklentilerin attığı oyuncuların kick sebebi — kısa ömürlü iz.
 *
 * NEDEN GEREKLİ: Squad'ın RCON kick yanıtı sebep TAŞIMIYOR. Gelen satır
 * `Kicked player 12. [Online IDs=...] Ad` biçiminde (bkz.
 * vendor/squad-server/rcon.js) ve adapter bundan sebepsiz bir ADMIN_ACTION
 * üretiyor. Sonuç: panelin canlı akışında çıplak bir "sunucudan atıldı"
 * satırı. Oyuncu neden atıldı — mangasız mı kaldı, kadro dışı mıydı,
 * oynama süresi mi yetmedi — hiçbir yerde yazmıyordu.
 *
 * Sebebi bilen tek taraf komutu GÖNDEREN. Panelden ve ban uygulamasından
 * gelen kickler için bu api tarafında çözülüyor (lib/panel-komut-izi.ts);
 * burası eklentilerin kendi kararıyla attığı oyuncular için — o sebep
 * agent'tan hiç çıkmıyordu.
 *
 * İŞ BÖLÜMÜ BİLİNÇLİ: her sebep, kaynağına en yakın yerde kaydediliyor.
 * İkisini tek yerde toplamak, sebebi doğduğu yerden uzağa taşımak ve iki
 * farklı eşleşme kuralını (kimlik / oyuncu adı) tek mekanizmaya
 * sıkıştırmak olurdu.
 */

/**
 * Yankının gelmesi için beklenen en uzun süre.
 *
 * RCON turu milisaniyeler sürüyor; 20 saniye fazlasıyla cömert. Üst sınır
 * olması şart: eşleşmeyen bir kayıt sonsuza kadar durursa, çok sonra aynı
 * oyuncu başka bir sebeple atıldığında ESKİ sebep gösterilirdi.
 */
const PENCERE_MS = 20_000;

/** İz birikmesin: eşleşmeyen kayıtlar bu sayıdan sonra temizleniyor. */
const TAVAN = 100;

const izler = new Map<string, { zaman: number; sebep: string }>();

function normalize(id: string): string {
  return id.trim().toLowerCase();
}

function eskileriAt(simdi: number) {
  for (const [k, iz] of izler) {
    if (simdi - iz.zaman > PENCERE_MS) izler.delete(k);
  }
}

/** Eklenti bir oyuncuyu attı. Sebep boşsa iz bırakılmıyor. */
export function kickSebebiKaydet(playerId: string, sebep: string): void {
  const kimlik = normalize(playerId);
  const temiz = sebep.trim();
  if (!kimlik || !temiz) return;
  const simdi = Date.now();
  if (izler.size > TAVAN) eskileriAt(simdi);
  izler.set(kimlik, { zaman: simdi, sebep: temiz });
}

/**
 * Yankıdaki kimliklerden sebebi bulur ve izi TÜKETİR.
 *
 * İki kimliğe de bakılıyor: eklentiler EOS'u tercih ediyor (Squad admin
 * komutlarında daha güvenilir) ama EOS'u olmayan oyuncuda SteamID'ye
 * düşüyorlar. Tek kimliğe bakmak, o oyuncuların sebebini kaybetmek olurdu.
 *
 * Tüketme ŞART: aynı iz ikinci bir yankıya da sebep yazsaydı, sonraki
 * sebepsiz bir kick yanlış bir açıklamayla görünürdü.
 */
export function kickSebebiAl(
  steamId: string | undefined,
  eosId: string | undefined,
): string | null {
  const simdi = Date.now();
  for (const aday of [eosId, steamId]) {
    if (!aday) continue;
    const kimlik = normalize(aday);
    const iz = izler.get(kimlik);
    if (!iz) continue;
    izler.delete(kimlik);
    if (simdi - iz.zaman <= PENCERE_MS) return iz.sebep;
  }
  return null;
}

/** Sadece testler için. */
export function kickSebepIzleriniSifirla(): void {
  izler.clear();
}
