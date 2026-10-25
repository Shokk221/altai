import { logger } from '@altai/shared';
import { type BmClient, BmHttpError, type BmResource } from './client.js';

/**
 * Tek bir oyuncunun BM'deki geçmişini okur — canlı aynanın BM tarafı.
 *
 * Arşiv aracı (`tools/bm-export`) org'un TAMAMINI dosyaya yazmak için var;
 * burası tek oyuncuyu sorup belleğe normalize eder. İkisi aynı istemciyi
 * paylaşır ama ihtiyaçları ters yönde: arşiv kaynak başına milyonlarca satırı
 * sayfalar, ayna tek oyuncu için birkaç istek atar ve sonucu hemen kullanır.
 *
 * BURADA HİÇBİR ŞEY YAZILMIYOR. Kick/ban/flag gibi yaptırımlar kendi
 * veritabanımızda; BM yalnızca okuma kaynağı (bkz. client.ts).
 */

/** Oyuncuyu BM'de ararken kullandığımız kimlikler. En az biri dolu olmalı. */
export interface BmKimlik {
  steamId?: string | null;
  eosId?: string | null;
}

export interface BmIsim {
  name: string;
  firstSeen: Date | null;
  lastSeen: Date | null;
  /** BM identifier kaydının id'si — yalnızca izlenebilirlik için. */
  externalId: string;
}

export interface BmNot {
  externalId: string;
  body: string;
  /** Notu yazan BM kullanıcısı. BM bazı notlarda kullanıcıyı vermiyor. */
  authorName: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface BmBan {
  externalId: string;
  reason: string;
  /** BM'de "note" alanı — yalnızca adminlerin gördüğü iç açıklama. */
  note: string | null;
  expiresAt: Date | null;
  createdAt: Date | null;
  issuedByName: string | null;
  banListName: string | null;
}

export interface BmSunucuSuresi {
  bmServerId: string;
  serverName: string | null;
  /** Saniye. BM bunu oyuncu-sunucu çifti başına tutuyor. */
  timePlayed: number | null;
  firstSeen: Date | null;
  lastSeen: Date | null;
}

export interface BmOyuncuAynasi {
  bmPlayerId: string;
  isimler: BmIsim[];
  notlar: BmNot[];
  banlar: BmBan[];
  sunucular: BmSunucuSuresi[];
  /**
   * 401/403/404 aldığımız alt kaynaklar. BOŞ KALMASI ÖNEMLİ: bir kaynak
   * buraya düşerse "o oyuncunun notu yok" ile "notları okuyamadık" ayrımı
   * korunur. İkisini karıştırmak, aynayı sessizce eksik gösterirdi.
   */
  erisilemeyen: string[];
}

function tarih(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function metin(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

/** JSON:API ilişkisinden tek bir kaynağın id'sini çıkarır. */
function iliskiId(rec: BmResource, key: string): string | null {
  const rel = rec.relationships?.[key] as { data?: { id?: unknown } } | undefined;
  const id = rel?.data?.id;
  return typeof id === 'string' ? id : null;
}

/**
 * Arama sonucundan, istediğimiz kimliğe GERÇEKTEN sahip oyuncuyu seçer.
 *
 * Bu fonksiyon aynanın güvenlik kilidi. BM'nin `filter[search]` filtresi
 * isme de bakıyor: "76561198..." diye aradığımızda dönen ilk sonucu körü
 * körüne kabul etmek, adında o rakamları taşıyan BAŞKA bir oyuncunun
 * notlarını ve banlarını bizim oyuncumuzun profiline yazmak olurdu.
 *
 * Bu yüzden eşleşme ismin değil, `include=identifier` ile gelen kimlik
 * kayıtlarının üzerinden kuruluyor: aradığımız değerin tam karşılığı bir
 * identifier yoksa sonuç REDDEDİLİR. Yanlış oyuncuyu bağlamak, hiç
 * bağlamamaktan çok daha pahalı — moderatör o notlara bakıp karar veriyor.
 */
export function eslesenOyuncuId(
  data: BmResource[],
  included: BmResource[],
  aranan: string,
): string | null {
  const adaylar = new Set(data.map((d) => d.id));
  const hedef = aranan.toLowerCase();

  for (const rec of included) {
    if (rec.type !== 'identifier') continue;
    const deger = rec.attributes?.identifier;
    if (typeof deger !== 'string' || deger.toLowerCase() !== hedef) continue;
    const playerId = iliskiId(rec, 'player');
    if (playerId && adaylar.has(playerId)) return playerId;
  }
  return null;
}

export interface BmBulOptions {
  /**
   * Aramayı bu sunuculara daraltır. Verilmesi TERCİH EDİLİR: filtresiz
   * arama BM'nin global oyuncu veritabanını tarıyor ve bizim oyuncumuz
   * olmayan isim eşleşmeleriyle döndüğü için hem yavaş hem gürültülü.
   */
  serverIds?: string[];
}

/**
 * SteamID/EOS ID'den BM oyuncu id'sini çözer. Bulamazsa null.
 *
 * Steam önce denenir: arşivdeki 111 bin oyuncunun neredeyse tamamı Steam
 * kimliğiyle kayıtlı, EOS ise yalnızca yeni oyuncularda tek kimlik.
 */
export async function bmOyuncuBul(
  client: BmClient,
  kimlik: BmKimlik,
  opts: BmBulOptions = {},
): Promise<string | null> {
  const aranacaklar = [kimlik.steamId, kimlik.eosId].filter(
    (v): v is string => typeof v === 'string' && v.length > 0,
  );
  if (aranacaklar.length === 0) return null;

  for (const deger of aranacaklar) {
    const params: Record<string, string> = {
      'filter[search]': deger,
      include: 'identifier',
      'page[size]': '10',
    };
    if (opts.serverIds?.length) params['filter[servers]'] = opts.serverIds.join(',');

    try {
      const page = await client.get('/players', params);
      const eslesen = eslesenOyuncuId(page.data, page.included, deger);
      if (eslesen) return eslesen;
    } catch (err) {
      // 400: filtre bu planda/uçta kabul edilmiyor. 401/403: token yetkisiz.
      // Üçü de bir SONRAKİ kimliği denemekle düzelmez ama diğer oyuncular
      // için denemeye devam etmek de anlamsız — çağıran bunu "çözülemedi"
      // olarak kaydeder ve TTL dolana kadar tekrar sormaz.
      if (err instanceof BmHttpError && [400, 401, 403, 404].includes(err.status)) {
        logger.warn(
          { status: err.status, kimlikTuru: deger === kimlik.steamId ? 'steam' : 'eos' },
          'BM oyuncu aramasi reddedildi',
        );
        return null;
      }
      throw err;
    }
  }
  return null;
}

/** Sayfalanan bir alt kaynağı toplar; erişim yoksa null döner (hata değil). */
async function topla(
  client: BmClient,
  path: string,
  params: Record<string, string>,
  etiket: string,
): Promise<{ data: BmResource[]; included: BmResource[] } | null> {
  const data: BmResource[] = [];
  const included: BmResource[] = [];
  try {
    for await (const page of client.paginate(path, params)) {
      data.push(...page.data);
      included.push(...page.included);
    }
    return { data, included };
  } catch (err) {
    if (err instanceof BmHttpError && [400, 401, 403, 404].includes(err.status)) {
      logger.warn({ etiket, status: err.status }, 'BM alt kaynagi erisilemiyor — atlandi');
      return null;
    }
    throw err;
  }
}

/**
 * Oyuncunun BM'deki tüm geçmişini tek seferde okur.
 *
 * Üç ayrı istek, çünkü BM bunları tek uçta vermiyor. İsimler ZORUNLU
 * (başarısızsa fırlatır), notlar ve banlar ise erişilemezse atlanır ve
 * `erisilemeyen` listesine yazılır: not yetkisi Premium aboneliğe bağlı ve
 * abonelik planı değiştiğinde aynanın tamamı durmamalı.
 */
export async function bmOyuncuAynasi(
  client: BmClient,
  bmPlayerId: string,
): Promise<BmOyuncuAynasi> {
  const erisilemeyen: string[] = [];

  // 1) İsim geçmişi + sunucu başına oynama süresi. İkisi de aynı uçtan
  //    geliyor: isimler `identifier` tipinde, süreler `server` kaydının
  //    meta'sında.
  const temel = await client.get(`/players/${bmPlayerId}`, { include: 'identifier,server' });

  const isimler: BmIsim[] = [];
  const sunucular: BmSunucuSuresi[] = [];
  const oyuncu = temel.data[0];

  for (const rec of temel.included) {
    if (rec.type === 'identifier' && rec.attributes?.type === 'name') {
      const name = metin(rec.attributes?.identifier);
      if (!name) continue;
      isimler.push({
        name,
        firstSeen: tarih(rec.attributes?.firstSeen),
        lastSeen: tarih(rec.attributes?.lastSeen),
        externalId: rec.id,
      });
      continue;
    }

    if (rec.type === 'server') {
      // Süre bilgisi normalde included sunucu kaydının meta'sında gelir.
      // Oyuncunun kendi relationships.servers girdisinde de taşındığı
      // durumlar var; ikisine de bakıyoruz çünkü eksik okunan bir süre
      // panelde "0 saat" olarak görünür ve bu yanlış bir bilgi.
      const meta = (rec.meta ?? {}) as Record<string, unknown>;
      const yedek = sunucuMetaYedegi(oyuncu, rec.id);
      const sure = meta.timePlayed ?? yedek.timePlayed;
      sunucular.push({
        bmServerId: rec.id,
        serverName: metin(rec.attributes?.name),
        timePlayed: typeof sure === 'number' ? sure : null,
        firstSeen: tarih(meta.firstSeen ?? yedek.firstSeen),
        lastSeen: tarih(meta.lastSeen ?? yedek.lastSeen),
      });
    }
  }

  // BM aynı ismi farklı identifier kayıtlarıyla defalarca bildiriyor
  // (arşiv importunda 4.064 isim 9.852 satıra bölünmüştü). Burada isim
  // başına tek satıra indiriyoruz ve aralığı genişletiyoruz — veritabanı
  // tarafındaki (player_id, name) tekilliğiyle aynı kural.
  const birlesik = isimBirlestir(isimler);

  // 2) Notlar. `include=user` yazarın adını getiriyor; o olmadan not
  //    "kim yazdı" bilgisi olmadan görünürdü ve moderasyonda not kadar
  //    değerli olan şey tam olarak bu.
  const notSonuc = await topla(
    client,
    `/players/${bmPlayerId}/relationships/notes`,
    { include: 'user', 'page[size]': '100' },
    'player-notes',
  );
  if (!notSonuc) erisilemeyen.push('notlar');

  const kullaniciAdlari = new Map<string, string>();
  for (const rec of notSonuc?.included ?? []) {
    if (rec.type !== 'user') continue;
    const ad = metin(rec.attributes?.nickname) ?? metin(rec.attributes?.name);
    if (ad) kullaniciAdlari.set(rec.id, ad);
  }

  const notlar: BmNot[] = [];
  for (const rec of notSonuc?.data ?? []) {
    const body = metin(rec.attributes?.note) ?? metin(rec.attributes?.text);
    // Boş not taşımıyoruz: panelde gövdesiz bir kayıt satırı olarak görünür
    // ve moderatöre hiçbir şey anlatmaz.
    if (!body) continue;
    const userId = iliskiId(rec, 'user');
    notlar.push({
      externalId: rec.id,
      body,
      authorName: userId ? (kullaniciAdlari.get(userId) ?? null) : null,
      createdAt: tarih(rec.attributes?.createdAt),
      updatedAt: tarih(rec.attributes?.updatedAt),
    });
  }

  // 3) Banlar. SADECE GÖSTERİM İÇİN okunuyor — ban uygulaması (ban-enforcer,
  //    uzak ban listesi) bu veriye hiç bakmıyor, ayrı bir tabloda duruyor.
  //    Bkz. db/schema/moderation.ts -> bmBans.
  const banSonuc = await topla(
    client,
    '/bans',
    { 'filter[player]': bmPlayerId, include: 'user,banList', 'page[size]': '100' },
    'player-bans',
  );
  if (!banSonuc) erisilemeyen.push('banlar');

  // Banı atan admin ve ban listesi adı ilişkilerde geliyor. İkisi de
  // gösterimin özü: "bu ban bizim mi, paylaşımlı bir listeden mi geldi"
  // sorusunun cevabı ban listesinin adında.
  const banListeAdlari = new Map<string, string>();
  for (const rec of banSonuc?.included ?? []) {
    if (rec.type === 'user') {
      const ad = metin(rec.attributes?.nickname) ?? metin(rec.attributes?.name);
      if (ad) kullaniciAdlari.set(rec.id, ad);
      continue;
    }
    if (rec.type === 'banList') {
      const ad = metin(rec.attributes?.name);
      if (ad) banListeAdlari.set(rec.id, ad);
    }
  }

  const banlar: BmBan[] = [];
  for (const rec of banSonuc?.data ?? []) {
    const userId = iliskiId(rec, 'user');
    const banListId = iliskiId(rec, 'banList');
    banlar.push({
      externalId: rec.id,
      reason: metin(rec.attributes?.reason) ?? '(sebep yazılmamış)',
      note: metin(rec.attributes?.note),
      // BM süresiz banı `expires: null` ile bildiriyor — bizdeki "kalıcı".
      expiresAt: tarih(rec.attributes?.expires),
      createdAt: tarih(rec.attributes?.timestamp) ?? tarih(rec.attributes?.createdAt),
      issuedByName: userId ? (kullaniciAdlari.get(userId) ?? null) : null,
      banListName: banListId ? (banListeAdlari.get(banListId) ?? null) : null,
    });
  }

  return { bmPlayerId, isimler: birlesik, notlar, banlar, sunucular, erisilemeyen };
}

/** Oyuncunun relationships.servers girdisindeki süre meta'sı (yedek yol). */
function sunucuMetaYedegi(
  oyuncu: BmResource | undefined,
  serverId: string,
): Record<string, unknown> {
  const rel = oyuncu?.relationships?.servers as
    | { data?: { id?: unknown; meta?: Record<string, unknown> }[] }
    | undefined;
  for (const girdi of rel?.data ?? []) {
    if (girdi.id === serverId) return girdi.meta ?? {};
  }
  return {};
}

/**
 * Aynı ismi tek satıra indirir, first/last aralığını genişletir.
 *
 * Dışa açık: testte doğrudan doğrulanıyor, çünkü yanlış birleştirme isim
 * geçmişini ya ikiler ya da bir oyuncunun bir ismi ne zaman kullandığı
 * bilgisini daraltır.
 */
export function isimBirlestir(isimler: BmIsim[]): BmIsim[] {
  const harita = new Map<string, BmIsim>();
  for (const isim of isimler) {
    const mevcut = harita.get(isim.name);
    if (!mevcut) {
      harita.set(isim.name, { ...isim });
      continue;
    }
    mevcut.firstSeen = enKucuk(mevcut.firstSeen, isim.firstSeen);
    mevcut.lastSeen = enBuyuk(mevcut.lastSeen, isim.lastSeen);
  }
  // Yeniden eskiye: profil ekranı güncel ismi en üstte bekliyor.
  return [...harita.values()].sort(
    (a, b) => (b.lastSeen?.getTime() ?? 0) - (a.lastSeen?.getTime() ?? 0),
  );
}

function enKucuk(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function enBuyuk(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
