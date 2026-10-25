/**
 * Altai sunucu kuralları — altaisquad.com/kurallar sayfasından BİREBİR.
 *
 * KAYNAK: https://altaisquad.com/kurallar (25.10.2026'da çekildi)
 *
 * Metin bilerek olduğu gibi duruyor, özetlenmedi ve yeniden yazılmadı:
 * bu kurallar ban mesajında oyuncuya gösteriliyor ve itiraz
 * tartışmalarında dayanak oluyor. Sitedeki metinle paneldeki metnin
 * ayrışması, iki ayrı kural setine sahip olmak demek.
 *
 * KODLAR SİTEDEN GELİYOR (GEN-1, SL-12, ARAÇ-7...). Panelde sıra
 * numarasından kod türetmiyoruz: oyuncular ve yetkililer bu kodları
 * zaten kullanıyor ve kurallar yeniden sıralandığında kod değişmemeli.
 *
 * Son kart olan KULLANIM bir kural değil, AcemiSL sisteminin kimlere
 * açık olduğunu anlatan not; sitede de kural kartı olarak duruyor ve
 * panelde aynı şekilde kalması tutarlılık için daha iyi.
 *
 * Güncellenmesi: site değişince bu dosya da elden geçirilmeli. Otomatik
 * çekmiyoruz — sunucunun kural metninin bir web sayfasının o anki
 * hâline bağlı olması, sayfa bozulduğunda panelin de bozulması demekti.
 */

export interface AltaiKurali {
  /** Sitedeki rozet: GEN-1, SL-12, ARAÇ-7, KULLANIM. */
  kod: string;
  /** Bölüm adı — panelde gruplama, veritabanında `category`. */
  bolum: string;
  /** Genel sıra (1..52); panelde `position`. */
  sira: number;
  /** Kuralın tam metni. "•" ile başlayan satırlar alt maddeler. */
  metin: string;
}

export const ALTAI_KURALLARI: AltaiKurali[] = [
  // ----------------------------------------------------------------------
  // Genel Kurallar
  // ----------------------------------------------------------------------
  {
    kod: 'GEN-1',
    bolum: 'Genel Kurallar',
    sira: 1,
    metin: `Oyunun akışını ve diğer oyuncuların deneyimini olumsuz etkileyen küfür, hakaret, ırkçı söylem, hile, trolling veya ghosting gibi davranışlar kesinlikle yasaktır.
• Oyunun akışını bozmayacak dahi olsa sözlü veya fiziksel şekilde oyuncuları kışkırtmak yasaktır.`,
  },
  {
    kod: 'GEN-2',
    bolum: 'Genel Kurallar',
    sira: 2,
    metin:
      'Takımın performansını olumsuz etkileyen ve oyun düzenini bozan her türlü davranış yasaktır.',
  },
  {
    kod: 'GEN-3',
    bolum: 'Genel Kurallar',
    sira: 3,
    metin: `• Kasıtlı olarak takım arkadaşını öldürmek yasaktır.
• All chatten özür dilenmediği taktirde kasıtlı TK olarak değerlendirilir.
• 60 saniye içerisinde all chate "Sorrytk" yazmaz ise sunucumuzdan otomatik olarak kicklenirsiniz.`,
  },
  {
    kod: 'GEN-4',
    bolum: 'Genel Kurallar',
    sira: 4,
    metin: 'Kasıtlı olarak dost FOB/HAB veya dost araçlara zarar vermek yasaktır.',
  },
  {
    kod: 'GEN-5',
    bolum: 'Genel Kurallar',
    sira: 5,
    metin:
      'Mikrofonda gereksiz gürültü yapmak, müzik çalmak veya diğer oyuncuları rahatsız edecek şekilde mikrofon kullanımı yasaktır.',
  },
  {
    kod: 'GEN-6',
    bolum: 'Genel Kurallar',
    sira: 6,
    metin:
      'Sunucuda herhangi bir markanın, klanın, sunucunun reklamı ve tartışma yaratacak konuların açılması yasaktır.',
  },
  {
    kod: 'GEN-7',
    bolum: 'Genel Kurallar',
    sira: 7,
    metin: `Config ve türev yazılımların kullanımı yasaklanmıştır.
• Harita üzerindeki herhangi bir nesnenin kaybolması
• Zemin objelerinin eksilmesi veya kaybolması
• Normalden daha az çim görselleştirilmesi
Renk ayarları bu yasak kapsamında değerlendirilmemektedir.`,
  },
  {
    kod: 'GEN-8',
    bolum: 'Genel Kurallar',
    sira: 8,
    metin: 'Kural açıklarından yararlanmak yasaktır.',
  },

  // ----------------------------------------------------------------------
  // Squad Leader Kuralları
  // ----------------------------------------------------------------------
  {
    kod: 'SL-1',
    bolum: 'Squad Leader Kuralları',
    sira: 9,
    metin:
      'Deneyimsiz oyuncuların, oyunun düzenini bozacak şekilde manga liderliği yapması yasaktır.',
  },
  {
    kod: 'SL-2',
    bolum: 'Squad Leader Kuralları',
    sira: 10,
    metin:
      'Manga liderleri, mikrofona sahip olmalı ve diğer liderlerle iletişim halinde bulunmalıdır.',
  },
  {
    kod: 'SL-3',
    bolum: 'Squad Leader Kuralları',
    sira: 11,
    metin:
      'Bir kimseyi ya da topluluğu rahatsız eden veya hakaret, siyasi içerik içeren manga isimleri koymak yasaktır.',
  },
  {
    kod: 'SL-4',
    bolum: 'Squad Leader Kuralları',
    sira: 12,
    metin: 'Manga lideri, mangayı kurduktan sonra başkasına sebepsiz yere devredemez.',
  },
  {
    kod: 'SL-5',
    bolum: 'Squad Leader Kuralları',
    sira: 13,
    metin: `• Manga liderlerinin, sebebini belirtmeden mangayı dağıtması yasaktır.
• Bir oyuncuyu mangadan atmadan önce geçerli bir sebep ile kendisine bildirmek zorundadır.`,
  },
  {
    kod: 'SL-6',
    bolum: 'Squad Leader Kuralları',
    sira: 14,
    metin: 'Piyade mangaları aktif objektiflere oynamak zorundadır.',
  },
  {
    kod: 'SL-7',
    bolum: 'Squad Leader Kuralları',
    sira: 15,
    metin: 'Lojistik araçlar piyade önceliklidir.',
  },
  {
    kod: 'SL-8',
    bolum: 'Squad Leader Kuralları',
    sira: 16,
    metin: `• Piyade mangaları OpenTop ve RWS araçlarında öncelikli claim hakkına sahiptir ancak;
• BRDM-2 Türevleri, MT-LB Türevleri, MT-LBM-6MA, FV432RWS, M113A3 TLAV ve AAVP-7A1 araçlarının mangası isimleriyle açılıp en az 1 en çok 3 kişiyle claim hakkı elde edilebilir.
• Yukarıda bahsedilen araçların piyade destek amaçlı kullanılması zorunludur.`,
  },
  {
    kod: 'SL-9',
    bolum: 'Squad Leader Kuralları',
    sira: 17,
    metin: 'Sızma ve Pusu mangası açmak yasaktır.',
  },
  {
    kod: 'SL-10',
    bolum: 'Squad Leader Kuralları',
    sira: 18,
    metin:
      "Bug'lı FOB veya HAB atılması yasaktır. Atılması durumunda en kısa sürede kaldırılması zorunludur.",
  },
  {
    kod: 'SL-11',
    bolum: 'Squad Leader Kuralları',
    sira: 19,
    metin: 'Manga liderleri, kendi piyadelerinin oynayışından ve araçlarından sorumludur.',
  },
  {
    kod: 'SL-12',
    bolum: 'Squad Leader Kuralları',
    sira: 20,
    metin: `• Piyade mangaları minimum 5 kişi ile kilitlenebilir.
• Klan mangaları, oyunda 5'ten fazla mangaya katılamayan oyuncu bulunmaması durumunda, 3 kişi ile kilitlenebilir.`,
  },
  {
    kod: 'SL-13',
    bolum: 'Squad Leader Kuralları',
    sira: 21,
    metin:
      'Crewman kiti gerektiren araçlar için (MBT Hariç) mekanize mangası açılabilir, açılacak manga ismi [Mekanize + "Kabul Edilen Araç İsmi"] şeklinde olmalıdır. Ör: "Mekanize BTR-82A" – "Mekanize M2A3"',
  },
  {
    kod: 'SL-14',
    bolum: 'Squad Leader Kuralları',
    sira: 22,
    metin: `• Mekanize piyade mangası lideri Crewman kiti alamaz. Araçta Sürücü ve Nişancı rolünde olamaz.
• Mekanize Piyade Mangası, Piyade mangalarından bağımsız oynayamaz. (Mekanize Piyade Mangası, Piyade Kurallarından muaf değildir.)
• Mekanize Piyade mangası, ismine uygun aracı, araç mangasından önce açmış ise claim hakkı mekanize piyade mangasındadır.`,
  },
  {
    kod: 'SL-15',
    bolum: 'Squad Leader Kuralları',
    sira: 23,
    metin:
      "Claimi olamayan veya düşmüş olan APC ve IFV'leri piyade mangaları kullanabilir. Araç patlayana kadar claim hakkı piyade mangasındadır.",
  },
  {
    kod: 'SL-16',
    bolum: 'Squad Leader Kuralları',
    sira: 24,
    metin:
      'Birden fazla araca sahip mangalar, aracı olmayan mangaların isteği üzerine araçlardan birini devretmek zorundadır.',
  },

  // ----------------------------------------------------------------------
  // Main Camp Kuralları
  // ----------------------------------------------------------------------
  {
    kod: 'MAINCAMP-1',
    bolum: 'Main Camp Kuralları',
    sira: 25,
    metin: `• Düşman ana üssünün (Main) sınırı 400 metre olup, FOB creation işaretinin dış çemberi ile belirlenir. Bu alana girmek ve ateş etmek kesinlikle yasaktır.
• Düşmanın ilk bayrak saldırmak için aktifleşene kadar maine giriş izni yoktur. Bayrak aktifleştiğinde maine giriş serbesttir ve bu andan itibaren maincamp sınırı kalkar.
• Aşağıda ismi geçen haritalarda maindeki bayrak üzerine atılmış FOB Creation markının küçük dairesi içerisinde maincamp kuralları geçerlidir. (Fool's Road, Logar, Mestia, Sumari)`,
  },
  {
    kod: 'MAINCAMP-2',
    bolum: 'Main Camp Kuralları',
    sira: 26,
    metin: `• Karşı takımın Maininden çıkan tüm yolları kapatmak, tutmak, pusmak veya mayınlamak yasaktır. Mainde en az bir çıkış yolu bırakılmalıdır.
• Eğer Mainin tek bir çıkış yolu varsa, bu yol ikiye ayrılana kadar tamamen tutulamaz. Yol ikiye ayrıldıktan sonra tek tarafı tutulabilir.
• Mainin her yöne açıldığı haritalarda (Mainden offroad çıkılabilecek haritalar ör: Mutaha ve AlBasrah) Maine herhangi bir yönden çevrelemek veya yaklaşmak sadece tek yolunu görebiliyor dahi olsanız yasaktır.`,
  },
  {
    kod: 'MAINCAMP-3',
    bolum: 'Main Camp Kuralları',
    sira: 27,
    metin: `• Takım ana üssünün (Main) sınırı 400 metre olup, FOB Creation işaretinin dış çemberi ile belirlenir. Bu alana FOB kurmak ve herhangi bir yapı inşa etmek yasaktır.
• Kendi Main bölgene yakın radyo kurulamaz. Radyonun küçük kapsama alanı (mavi çember), Main bayrağı üzerindeki FOB Creation işaretinin dış çemberiyle çakışıyorsa bu radyo kurulamaz. Kurulmuşsa en kısa sürede kaldırılması zorunludur. Ancak, FOB Creation işaretinin içinde bir cap bulunuyorsa ve bu capten bir ilerideki cap savunmak için aktifse radyo kurulabilir.
• Main içerisinden herhangi bir araç, kurulabilir silah veya piyade ile ateş açmak yasaktır. Main çevresinde size doğrudan tehdit oluşturan hedeflere, kendinizi savunma amacıyla ateş edebilirsiniz.`,
  },
  {
    kod: 'MAINCAMP-4',
    bolum: 'Main Camp Kuralları',
    sira: 28,
    metin: `• Main dışındayken sana ateş eden ve maine kaçan bir araca ateş etmeye başladıysan, araç daha sonra Main sınırları içine kaçsa bile imha etmen kural ihlali sayılmaz. Ancak herhangi bir şekilde Main içerisine girmek yasaktır.
• Lojistik ve Transport bu kurala dahil değildir.`,
  },
  {
    kod: 'MAINCAMP-5',
    bolum: 'Main Camp Kuralları',
    sira: 29,
    metin:
      'Bu kurallar, adil oyun ve takım deneyimini korumak amacıyla yazılmıştır. Herhangi bir kural ihlali durumunda sunucu yetkilileri değerlendirme yapacak ve gerekirse yaptırım uygulayacaktır.',
  },

  // ----------------------------------------------------------------------
  // Araç Mangası Kuralları
  // ----------------------------------------------------------------------
  {
    kod: 'ARAÇ-1',
    bolum: 'Araç Mangası Kuralları',
    sira: 30,
    metin: `• Araç mangalarının isimleri ancak araçların isimleriyle açılmalıdır.
• Eğer araçlar arasında isim benzerliği yoksa, yalnızca kısa ismiyle açılabilir.
Haritada sadece BTR-82A bulunuyorsa, manga adı "BTR" olarak açılabilir. Ancak haritada BTR-82A ve BTR-80 birlikte varsa, karışıklığı önlemek için varyasyonlarıyla birlikte yazılmalıdır (ör: "BTR-82A" "BTR-80").`,
  },
  {
    kod: 'ARAÇ-2',
    bolum: 'Araç Mangası Kuralları',
    sira: 31,
    metin:
      'MBT, IFV, APC ve Araçların kod isimleri (ör: M2A3 = Bradley) kabul edilmez ancak HELİ kabul edilebilir. Haritada farklı helikopterler var ise HELİ ismi kabul edilmez. Helikopterin tam ismiyle mangasının açılması gerekmektedir.',
  },
  {
    kod: 'ARAÇ-3',
    bolum: 'Araç Mangası Kuralları',
    sira: 32,
    metin: 'Araç claim hakkı, o aracın ismiyle manga açan ilk mangaya aittir.',
  },
  {
    kod: 'ARAÇ-4',
    bolum: 'Araç Mangası Kuralları',
    sira: 33,
    metin: 'Crewman kiti gerektiren araçlar en az 2 kişiyle mainden hareket etmelidir.',
  },
  {
    kod: 'ARAÇ-5',
    bolum: 'Araç Mangası Kuralları',
    sira: 34,
    metin: `• Araç mangalarında, en fazla araçtaki efektif koltuk sayısı kadar oyuncu barındırabilir.
• Helikopter mangalarında, en fazla helikopterdeki efektif koltuk sayısı (Pilot, Scout Cam ve Silahlar) kadar kişi olabilir.`,
  },
  {
    kod: 'ARAÇ-6',
    bolum: 'Araç Mangası Kuralları',
    sira: 35,
    metin: 'Araç ve Helikopter mangalarının özel (Special) kit almaları yasaktır.',
  },
  {
    kod: 'ARAÇ-7',
    bolum: 'Araç Mangası Kuralları',
    sira: 36,
    metin: `• Helikopter ile kamikaze yapmak yasaktır.
• Düşman helikopterinin pervanesini alabilirsiniz veya patlatabilirsiniz fakat kendi helikopterinizde patlar ise kamikaze olarak değerlendirilir.`,
  },
  {
    kod: 'ARAÇ-8',
    bolum: 'Araç Mangası Kuralları',
    sira: 37,
    metin: `• Araç israfı yapmak yasaktır.
• Acemilik bu kurala dahildir.
• Acemi Araç mangası açmak yasaktır.`,
  },
  {
    kod: 'ARAÇ-9',
    bolum: 'Araç Mangası Kuralları',
    sira: 38,
    metin:
      'Tow, Mortar, AntiAir, Grad ve UB32 gibi araçların mangası açılmalıdır. En fazla 2 kişi bulundurabilir.',
  },
  {
    kod: 'ARAÇ-10',
    bolum: 'Araç Mangası Kuralları',
    sira: 39,
    metin: 'Araç mangalarının Commander rolü alması yasaktır.',
  },
  {
    kod: 'ARAÇ-11',
    bolum: 'Araç Mangası Kuralları',
    sira: 40,
    metin: 'Araç mangaları araçları doğduktan sonra almaz, 3dk geçer ise claim hakkını kaybeder.',
  },

  // ----------------------------------------------------------------------
  // Destek Mangası Kuralları
  // ----------------------------------------------------------------------
  {
    kod: 'DES-1',
    bolum: 'Destek Mangası Kuralları',
    sira: 41,
    metin: 'TOW ve Mortar mangaları en az 2 en çok 3 kişi bulundurabilirler.',
  },
  {
    kod: 'DES-2',
    bolum: 'Destek Mangası Kuralları',
    sira: 42,
    metin: 'Her takımda destek mangalarında maksimum 1 TOW, 1 Mortar mangası açabilir.',
  },
  {
    kod: 'DES-3',
    bolum: 'Destek Mangası Kuralları',
    sira: 43,
    metin: 'TOW ve Mortar mangalarının özel (Special) kitleri kullanmaları yasaktır.',
  },
  {
    kod: 'DES-4',
    bolum: 'Destek Mangası Kuralları',
    sira: 44,
    metin:
      'TOW ve Mortar mangaları, kurulu silahlarını kaybederse veya bu silahlar düşman tarafından ele geçirilirse, öncelikli hedefleri bu silahları geri almak veya yok etmek olmalıdır.',
  },
  {
    kod: 'DES-5',
    bolum: 'Destek Mangası Kuralları',
    sira: 45,
    metin: `• SuperFOB mangası en fazla 5 kişi olabilir ve sadece Invasion modunda açılabilir.
• SuperFOB aktif savunma bayrağının en fazla 2 bayrak gerisine kurulabilir.
• SuperFOB mangası özel (Special) kit olarak SADECE Sapper/Combat Engineer alabilir.
• Logistic kamyonlarına ihtiyaç kalmadığında Main'e geri bırakılmalıdır veya diğer SL'lere götürülmelidir.`,
  },

  // ----------------------------------------------------------------------
  // AcemiSL Kuralları
  // ----------------------------------------------------------------------
  {
    kod: 'ASL-1',
    bolum: 'AcemiSL Kuralları',
    sira: 46,
    metin: `• AcemiSL'in oyundaki Commander'ı dinlemek zorundadır.
• Eğer oyunda Commander yoksa tecrübeli SL'leri dinlemelidir ve deneyimli oyuncularının yapıcı eleştirilerini agresif bir şekilde reddetmesi yasaktır.`,
  },
  {
    kod: 'ASL-2',
    bolum: 'AcemiSL Kuralları',
    sira: 47,
    metin: 'AcemiSL sistemini kötüye kullanacak herhangi bir hareket yasaktır.',
  },
  {
    kod: 'ASL-3',
    bolum: 'AcemiSL Kuralları',
    sira: 48,
    metin: `• Acemi SL mangasını oyundan atılmamak için kullanıp takımı yönetmemek yasaktır.
• Her SL takımı yönetmek zorundadır.`,
  },
  {
    kod: 'KULLANIM',
    bolum: 'AcemiSL Kuralları',
    sira: 49,
    metin:
      'Eğer 200 saatten az ama 80 saatten fazla oyun süreniz bulunuyor ise sistemden yararlanabilirsiniz. Manga isminizi Acemi SL olarak açmak zorundasınız.',
  },

  // ----------------------------------------------------------------------
  // Yayıncı Kuralları
  // ----------------------------------------------------------------------
  {
    kod: 'YK-1',
    bolum: 'Yayıncı Kuralları',
    sira: 50,
    metin:
      'Sunucumuzda yayın yapmadan önce #başvuru kanalından içerik üreticisi kategorisinde sunucumuza başvurmanız gerekmektedir.',
  },
  {
    kod: 'YK-2',
    bolum: 'Yayıncı Kuralları',
    sira: 51,
    metin:
      'Yayın esnasında oyun içi harita yayına yansıtılmamalıdır. Eğer haritayı kapatmak istemiyorsanız yayına 15 dakika gecikme koymak zorunludur.',
  },
  {
    kod: 'YK-3',
    bolum: 'Yayıncı Kuralları',
    sira: 52,
    metin:
      'Yayın esnasında herhangi bir kişiye oyun üzerinden olmasa dahi, sözlü veya yazılı hakaret ya da küfredilmesi halinde yayıncıya işlem uygulanır.',
  },
];

/** Bölümler, sitedeki sırayla. */
export const ALTAI_KURAL_BOLUMLERI = [
  'Genel Kurallar',
  'Squad Leader Kuralları',
  'Main Camp Kuralları',
  'Araç Mangası Kuralları',
  'Destek Mangası Kuralları',
  'AcemiSL Kuralları',
  'Yayıncı Kuralları',
] as const;

/**
 * Kuralın kısa karşılığı — ban mesajında kodun yanında duran açıklama.
 *
 * Sitedeki kuralların ayrı bir başlığı yok, yalnızca kod ve gövde var.
 * Ban mesajı oyuncunun gördüğü tek şey ve oraya 700 karakterlik bir
 * madde listesi sığmıyor; ilk cümle kuralın kendisini söylüyor.
 */
export function kuralOzeti(metin: string, enFazla = 140): string {
  const ilk = (metin.split('\n')[0] ?? '').replace(/^•\s*/, '').trim();
  if (ilk.length <= enFazla) return ilk;
  // Kelime ortasından kesmiyoruz.
  const kesik = ilk.slice(0, enFazla);
  const son = kesik.lastIndexOf(' ');
  return `${(son > 60 ? kesik.slice(0, son) : kesik).trim()}…`;
}
