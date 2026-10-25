/**
 * Ban mesajındaki kısa açıklamalar.
 *
 * NEDEN AYRI: kuralın kendi metni uzun ve madde madde — GEN-1 dört
 * satır, MAINCAMP-3 yedi yüz karakter. Oyuncunun ban ekranında gördüğü
 * tek şey bu mesaj ve oraya kuralın tamamı sığmıyor. Önce gövdenin ilk
 * satırı kesilerek kullanılıyordu; bu bazen yarım cümle, bazen alakasız
 * bir alt madde veriyordu.
 *
 * Buradaki metinler kuralların YERİNE GEÇMİYOR: kural metni
 * veritabanında ve /kurallar ekranında olduğu gibi duruyor, sitedeki
 * haliyle birebir. Bu tablo yalnızca "ban ekranında ne yazsın"
 * sorusunun cevabı.
 *
 * Kodla eşleşiyor, sırayla değil: kurallar yeniden sıralanabilir ama
 * GEN-3 her zaman GEN-3.
 *
 * Yeni bir kural panelden eklenirse burada karşılığı olmaz; o durumda
 * gövdenin ilk satırına düşülüyor (bkz. kural.ts → kuralOzeti).
 */
export const BAN_ACIKLAMALARI: Record<string, string> = {
  // -------------------------------------------------- Genel Kurallar
  'GEN-1': 'Küfür, hakaret, ırkçılık, hile, trolling, ghosting veya oyuncuları kışkırtma.',
  'GEN-2': 'Takımın oyun düzenini veya performansını bozma.',
  'GEN-3': 'Takım arkadaşını öldürme veya TK sonrası özür dilememe.',
  'GEN-4': 'Dost FOB, HAB veya araçlara kasıtlı zarar verme.',
  'GEN-5': 'Mikrofonu rahatsız edici şekilde kullanma.',
  'GEN-6': 'Reklam yapma veya tartışma yaratacak konular açma.',
  'GEN-7': 'Yasaklı config veya görsel avantaj sağlayan yazılım kullanma.',
  'GEN-8': 'Kural açıklarından yararlanma.',

  // ------------------------------------------ Squad Leader Kuralları
  'SL-1': 'Yetersiz deneyimle oyun düzenini bozan manga liderliği.',
  'SL-2': 'SL mikrofon veya liderler arası iletişim zorunluluğuna uymama.',
  'SL-3': 'Uygunsuz, siyasi veya hakaret içeren manga ismi.',
  'SL-4': 'Manga liderliğini sebepsiz devretme.',
  'SL-5': 'Mangayı sebepsiz dağıtma veya oyuncuyu gerekçesiz atma.',
  'SL-6': 'Aktif objektiflere oynamama.',
  'SL-7': 'Lojistik araçlarda piyade önceliğini ihlal etme.',
  'SL-8': 'OpenTop/RWS araç claim veya piyade destek kurallarını ihlal etme.',
  'SL-9': 'Yasaklı sızma veya pusu mangası açma.',
  'SL-10': "Bug'lı FOB/HAB kurma veya kaldırmama.",
  'SL-11': 'Manga piyadelerinin veya araçlarının kural ihlali.',
  'SL-12': 'Minimum oyuncu sayısına uymadan manga kilitleme.',
  'SL-13': 'Mekanize manga isimlendirme veya araç kurallarını ihlal etme.',
  'SL-14': 'Mekanize manga rolü, araç claim veya piyade kurallarını ihlal etme.',
  'SL-15': 'APC/IFV claim hakkını ihlal etme.',
  'SL-16': 'Talep edildiğinde fazla aracı diğer mangaya devretmeme.',

  // --------------------------------------------- Main Camp Kuralları
  'MAINCAMP-1': 'Düşman Main bölgesi sınırını ihlal etme.',
  'MAINCAMP-2': 'Düşman Main çıkışlarını yasaklı şekilde tutma veya kapatma.',
  'MAINCAMP-3': 'Kendi Main bölgesinde yasaklı yapı kurma veya ateş açma.',
  'MAINCAMP-4': 'Main bölgesine kaçan araca müdahale kurallarını ihlal etme.',
  'MAINCAMP-5': 'Main Camp kurallarına aykırı davranış.',

  // ----------------------------------------- Araç Mangası Kuralları
  'ARAÇ-1': 'Araç mangasını uygun araç ismiyle açmama.',
  'ARAÇ-2': 'Yasaklı veya belirsiz araç manga ismi kullanma.',
  'ARAÇ-3': 'Araç claim önceliğini ihlal etme.',
  'ARAÇ-4': 'Crewman aracıyla 2 kişiden az hareket etme.',
  'ARAÇ-5': 'Araç mangasında izin verilenden fazla oyuncu bulundurma.',
  'ARAÇ-6': 'Araç mangasında yasaklı Special kit kullanma.',
  'ARAÇ-7': 'Helikopterle kamikaze yapma.',
  'ARAÇ-8': 'Araç israfı veya deneyimsiz araç mangası açma.',
  'ARAÇ-9': 'Destek aracının manga veya oyuncu sınırı kurallarını ihlal etme.',
  'ARAÇ-10': 'Araç mangasında Commander rolü alma.',
  'ARAÇ-11': 'Aracı zamanında teslim almayarak claim hakkını kaybetme.',

  // --------------------------------------- Destek Mangası Kuralları
  'DES-1': 'TOW/Mortar manga oyuncu sınırını ihlal etme.',
  'DES-2': 'Takımın TOW/Mortar manga limitini aşma.',
  'DES-3': 'TOW/Mortar mangasında yasaklı Special kit kullanma.',
  'DES-4': 'Kaybedilen TOW/Mortar silahını geri alma veya imha etme önceliğine uymama.',
  'DES-5': 'SuperFOB manga, konum, kit veya lojistik kurallarını ihlal etme.',

  // ------------------------------------------- Acemi SL Kuralları
  'ASL-1': 'Commander veya deneyimli SL yönlendirmelerine uymama.',
  'ASL-2': 'Acemi SL sistemini kötüye kullanma.',
  'ASL-3': 'Acemi SL mangası açıp takımı yönetmeme.',

  // --------------------------------------------- Yayıncı Kuralları
  'YK-1': 'Yayıncı başvurusu yapmadan yayın açma.',
  'YK-2': 'Haritayı gecikmesiz yayına yansıtma.',
  'YK-3': 'Yayında küfür veya hakaret etme.',
};

/**
 * Ban gerekçesi OLAMAYACAK kayıtlar.
 *
 * `KULLANIM` sitede kural kartı olarak duruyor ama kural değil: AcemiSL
 * sisteminin kimlere açık olduğunu anlatan not. Ban penceresinde
 * seçilebilir olması, kimseyi "kullanım notunu ihlal etti" diye
 * banlayabilmek demekti.
 */
export const BANLANAMAZ = new Set(['KULLANIM']);
