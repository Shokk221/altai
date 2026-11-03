/**
 * Eski sistemin YAYINLADIĞI yetkili listesini bizim grant'larımızla uzlaştırır.
 *
 * NEDEN BU DOSYA VAR: `index.ts` yetkileri Mongo DÖKÜMÜNDEN aktardı ve o
 * döküm alındığı güne dondu. Canlıda ölçtüm (3 Kasım 2026) — fark küçük
 * değil. Aşağıdakiler kişi+grup ÇİFTİ sayısı, aracın kendi diliyle:
 *
 *   kaynaktaki üye satırı               548
 *   bizdeki aktif grant                 488
 *   kaynakta var, bizde yok             161   <- geçişte ayrıcalığı GİDER
 *   bizde var, kaynakta yok             135   <- hak sahibi olmayana veriyoruz
 *   iki tarafta aynı                    353
 *   bizde grup olarak hiç yok           BicakWL
 *   bizde var, kaynakta tanımsız        dumduzWL
 *
 * Sayılar günceldir diye varsayma: ölçüm aracın kendisi, kuru koşu her
 * seferinde yeniden sayıyor. Durum şu: `RemoteAdminListHosts.cfg`'yi
 * bugün bize çevirsek 161 eşleşme oyun içi ayrıcalığını kaybederdi. Ban
 * listesindeki hatanın aynısı, ters yönde: orada af görmüş insanlar banlı
 * kalıyordu, burada hak sahibi insanlar haksız kalıyor.
 *
 * KAYNAK NEDEN MONGO DEĞİL: eski sistem yetkili listesini halka açık bir
 * adreste sunuyor ve oyun sunucusu TAM O DOSYAYI okuyor. Yani o dosya
 * "eski sistemde ne yazıyor"ın değil, "oyunda şu an ne geçerli"nin
 * kaynağı. Mongo dökümü ise bir anın fotoğrafı. Token da gerekmiyor.
 *
 * ÖNEMLİ SINIR — YETKİLİ GRUPLAR ELLE VERİLMEZ: Admin/SuperAdmin gibi
 * gruplar yalnızca Discord zincirinden gelir (bkz. routes/admin-list.ts).
 * Eski sistemde bu kişiler elle eklenmiş; onları grant olarak geri yazmak
 * iki paralel yetki mekanizması kurardı — yeni tasarımın ortadan
 * kaldırmak için var olduğu şey. Bu yüzden burada yalnızca RAPORLANIYOR,
 * asla yazılmıyor.
 */

/** `Group=<ad>:<yetkiler>` satırı. */
export interface GrupTanimi {
  ad: string;
  /** Virgülle ayrılmış Squad erişim seviyeleri; boş olabilir. */
  yetkiler: string;
}

/** `Admin=<kimlik>:<grup> // not` satırı. */
export interface KaynakUye {
  /** SteamID (17 hane) ya da EOS ID (32 hex). */
  kimlik: string;
  grup: string;
  not?: string;
}

export interface KaynakListe {
  gruplar: GrupTanimi[];
  uyeler: KaynakUye[];
  /** Ayrıştırılamayan, boş ve yorum olmayan satırlar — sessiz veri kaybına karşı. */
  anlasilmayan: string[];
}

/**
 * Squad Admins.cfg biçimini ayrıştırır.
 *
 * `anlasilmayan` bilerek toplanıyor: eski sistem bir gün satır biçimini
 * değiştirirse liste sessizce küçülür ve biz bunu "insanlar silinmiş"
 * diye okuruz. Sayı sıfır değilse uzlaştırma durmalı.
 */
export function adminsCfgAyristir(metin: string): KaynakListe {
  const gruplar: GrupTanimi[] = [];
  const uyeler: KaynakUye[] = [];
  const anlasilmayan: string[] = [];

  for (const satir of metin.split(/\r?\n/)) {
    const s = satir.trim();
    if (!s || s.startsWith('//')) continue;

    const g = /^Group=([^:]+):(.*)$/.exec(s);
    if (g?.[1] !== undefined) {
      // Yorum satır sonunda olabiliyor: `Group=X:reserve // açıklama`
      const yetkiler = (g[2] ?? '').split('//')[0] ?? '';
      gruplar.push({ ad: g[1].trim(), yetkiler: yetkiler.trim() });
      continue;
    }

    const a = /^Admin=(\S+?):(\S+)\s*(?:\/\/\s*(.*))?$/.exec(s);
    if (a?.[1] !== undefined && a[2] !== undefined) {
      const not = a[3]?.trim();
      uyeler.push({ kimlik: a[1].trim(), grup: a[2].trim(), ...(not ? { not } : {}) });
      continue;
    }

    anlasilmayan.push(s);
  }

  return { gruplar, uyeler, anlasilmayan };
}

export interface SaglikKarari {
  guvenli: boolean;
  gerekce?: string;
}

/**
 * Kaynağın kendisi sağlam mı?
 *
 * Bu kontrol ÇIKTININ büyüklüğüne bakmıyor — bilerek. Bizdeki fazlalığın
 * temizlenmesi (eski sistemde artık olmayan 126 kişi) büyük bir yığın ve
 * DOĞRU bir iş; onu bir orana takılıp reddetmek, aracı işe yaramaz kılar.
 * Burada korunan şey başka: yarım inmiş, boş ya da biçimi değişmiş bir
 * kaynak dosyayı "eski sistem herkesi silmiş" diye okumak.
 */
export function kaynakSagligi(kaynak: KaynakListe, bizdekiKisi: number): SaglikKarari {
  if (kaynak.uyeler.length === 0) {
    return {
      guvenli: false,
      gerekce: 'kaynak listede hiç üye satırı yok — indirme boş ya da bozuk',
    };
  }
  if (kaynak.gruplar.length === 0) {
    return {
      guvenli: false,
      gerekce: 'kaynak listede hiç grup tanımı yok — biçim değişmiş olabilir',
    };
  }
  const toplamSatir = kaynak.uyeler.length + kaynak.gruplar.length + kaynak.anlasilmayan.length;
  if (kaynak.anlasilmayan.length > toplamSatir * EN_COK_ANLASILMAYAN_ORANI) {
    return {
      guvenli: false,
      gerekce: `${toplamSatir} satırın ${kaynak.anlasilmayan.length}'i ayrıştırılamadı (ilki: ${kaynak.anlasilmayan[0]?.slice(0, 60)}) — biçim değişmiş olabilir`,
    };
  }
  // Bizde hiç kayıt yoksa karşılaştıracak bir şey yok; ilk doldurma serbest.
  if (bizdekiKisi === 0) return { guvenli: true };

  if (kaynak.uyeler.length < bizdekiKisi * EN_AZ_KAYNAK_ORANI) {
    return {
      guvenli: false,
      gerekce: `kaynakta ${kaynak.uyeler.length} satır var ama bizde ${bizdekiKisi} kişi kayıtlı; dosya yarım inmiş olabilir`,
    };
  }
  return { guvenli: true };
}

/**
 * Kaynak, bizdeki kişi sayısının bu oranından küçükse eksik sayılıyor.
 *
 * Kaynak satır sayısı kişi sayısından fazla olabilir (aynı kişi hem EOS
 * hem SteamID ile yazılmış), yani bu eşik cömert tarafta — amaç yarım
 * inmiş dosyayı yakalamak, ince farkı değil.
 */
const EN_AZ_KAYNAK_ORANI = 0.5;

/**
 * Ayrıştırılamayan satırların bu orandan fazlası biçim değişikliği sayılıyor.
 *
 * NEDEN ORAN, NEDEN SIFIR TOLERANS DEĞİL: canlıda ölçtüm, eski sistemin
 * listesinde 560 satırın BİRİ bozuk:
 *
 *   Admin=PARMAKSIZ Veteran:VeteranWL //76561198427772079
 *
 * Kimlik alanına isim, yoruma SteamID yazılmış — bir veri girişi hatası.
 * O satır Squad'ın kendi ayrıştırıcısında da geçersiz, yani o kişinin şu
 * an OYUNDA da whitelist'i yok; biz bir şey kaybetmiyoruz. Ama sıfır
 * tolerans bu tek satır yüzünden aracı kalıcı olarak kilitliyordu ve
 * kimse eski sistemi düzeltmeyeceği için liste hiç uzlaşmıyordu.
 *
 * Ayırt edici olan şu: biçim değişikliği tek satırı değil YIĞINI bozar.
 * Eşiğin altında kalan satırlar yok sayılmıyor — çağıran taraf hepsini
 * tek tek basıyor (bkz. `yetkili-uzlastir.ts`).
 */
const EN_COK_ANLASILMAYAN_ORANI = 0.02;

/** Bu orandan fazlası düşecekse insan onayı isteniyor. */
export const ONAY_ESIGI = 0.2;

/** Kişi+grup çifti — uzlaştırmanın birimi. */
export type Cift = `${string}|${string}`;
export const cift = (kisi: string, grup: string): Cift => `${kisi}|${grup}`;

export interface GrantFarki {
  eklenecek: Cift[];
  dusecek: Cift[];
  ayni: number;
  /** Düşecek oran eşiği aştı mı — `--dusurmeyi-onayla` isteniyor. */
  onayGerekli: boolean;
}

/**
 * Kişi+grup çiftlerini karşılaştırır.
 *
 * Birim neden çift: aynı kişi hem KlanWL hem VeteranWL olabiliyor ve eski
 * sistemde bunlardan yalnızca biri kaldırılmış olabilir. Kişi bazında
 * karşılaştırsak "hâlâ listede" diye farkı kaçırırdık.
 */
export function grantFarki(
  kaynakCiftleri: Iterable<Cift>,
  bizdekiCiftler: Iterable<Cift>,
): GrantFarki {
  const kaynak = new Set(kaynakCiftleri);
  const bizdeki = new Set(bizdekiCiftler);

  const eklenecek: Cift[] = [];
  let ayni = 0;
  for (const c of kaynak) {
    if (bizdeki.has(c)) ayni++;
    else eklenecek.push(c);
  }

  const dusecek: Cift[] = [];
  for (const c of bizdeki) if (!kaynak.has(c)) dusecek.push(c);

  return {
    eklenecek,
    dusecek,
    ayni,
    onayGerekli: bizdeki.size > 0 && dusecek.length > bizdeki.size * ONAY_ESIGI,
  };
}
