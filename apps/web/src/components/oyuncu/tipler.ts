import type { Mesaj } from '@/components/chat-panel';

/**
 * Oyuncu profilinin veri tipleri.
 *
 * Sayfadan AYRI dosyada: hem sayfanın kendisi hem düzen denemeleri hem de
 * örnek veri aynı şekli kullanıyor. Tip tek yerde durmazsa üçü sessizce
 * ayrışıyor.
 */

export interface Ban {
  id: string;
  reason: string;
  internalNote: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  issuedByName: string | null;
  createdAt: string;
  source: string;
  active: boolean;
}

export interface Flag {
  id: string;
  flagId: string;
  name: string;
  color: string | null;
  addedAt: string;
  removedAt: string | null;
  /** Süreli etiketlerde bitiş; null = süresiz. SL ban için eklendi. */
  expiresAt: string | null;
  /** Yaptırım etiketlerinde zorunlu (SL ban), serbest etiketlerde boş. */
  reason: string | null;
  /**
   * Sunucu hesaplıyor: kaldırılmamış VE süresi dolmamış.
   *
   * Tarayıcıda `!removedAt` diye hesaplamak süre eklendikten sonra yanlış
   * cevap verir; kural api'de tek yerde (lib/etiket-aktif.ts).
   */
  active: boolean;
}

export interface Kayit {
  id: string;
  kind: 'note' | 'warning' | 'watchlist';
  body: string;
  authorName: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/**
 * BattleMetrics'te görünen ban — YAPTIRIM DEĞİL, bilgi.
 *
 * Bizim `Ban` tipinden ayrı durması bilinçli: o tipin `active` alanı var ve
 * panelde kırmızı "aktif" rozetiyle gösteriliyor, çünkü gerçekten
 * uygulanıyor. BM banı uygulanmıyor; aynı rozetle göstermek moderatöre
 * oyuncunun bizim sunucumuzdan yasaklı olduğunu söylerdi.
 */
export interface BmBan {
  id: string;
  reason: string;
  note: string | null;
  expiresAt: string | null;
  issuedAt: string | null;
  issuedByName: string | null;
  banListName: string | null;
}

export interface BmAyna {
  /** Ayna açık mı (token tanımlı ve BM_SYNC=on). */
  acik: boolean;
  bmPlayerId: string | null;
  syncedAt: string | null;
  status: 'ok' | 'bulunamadi' | 'hata' | null;
  /** Okunamayan alt kaynaklar ('notlar', 'banlar'). */
  erisilemeyen: string[];
  sunucular: {
    bmServerId: string;
    serverName: string | null;
    timePlayed: number | null;
    firstSeen: string | null;
    lastSeen: string | null;
  }[];
  banlar: BmBan[];
}

export interface Profil {
  player: {
    id: string;
    steamId: string | null;
    eosId: string | null;
    battlemetricsId: string | null;
    name: string;
  };
  names: { name: string; firstSeen: string | null; lastSeen: string | null }[];
  bans: Ban[];
  flags: Flag[];
  records: Kayit[];
  sohbet: Mesaj[];
  oyun: {
    oturum: number;
    toplamSaniye: number;
    ilkGorulme: string | null;
    sonGorulme: string | null;
    mac: number;
    kill: number;
    olum: number;
    revive: number;
    tk: number;
    enUzunSeri: number;
    galibiyet: number;
    maglubiyet: number;
    /** Bilinen sonuç yoksa null — sıfır "hep kaybetti" demekti. */
    galibiyetOrani: number | null;
  };
  /**
   * BM'den gelen eski isimler ve notlar YUKARIDAKİ `names`/`records`
   * içinde — ayrı liste yok, çünkü ayna onları doğrudan o tablolara
   * yazıyor. Burada yalnızca aynanın kendisine dair olan var.
   *
   * İSTEĞE BAĞLI, bilinçli: api'nin bu alanı döndürmediği bir sürümü
   * canlıdayken panel yeni sürüme geçebiliyor (ya da tersi). Alan
   * zorunluyken `profil.bm.sunucular` doğrudan patlıyordu ve profil
   * sayfası 500 veriyordu. Dağıtım sırasında iki tarafın sürümü birkaç
   * saniye de olsa ayrışıyor; ekran buna dayanmak zorunda.
   */
  bm?: BmAyna;
}

/** Yetkiler — sayfanın her parçası aynı üç soruyu soruyor. */
export interface Yetkiler {
  banlayabilir: boolean;
  notYazabilir: boolean;
  etiketYonetir: boolean;
}
