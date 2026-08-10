import type { ActivityCategory, ActorType } from '@altai/db';
import { redactUrl } from './log-redact.js';

/**
 * HTTP isteklerinin günlüğe nasıl düşeceğinin kuralları.
 *
 * Saf fonksiyonlar hâlinde ayrı duruyor çünkü buradaki iki hata da sessiz
 * olurdu: fazla yazarsak günlük kullanılamayacak kadar gürültülü olur, az
 * yazarsak hesap sorulması gereken an kayıt bulunmaz. İkisi de ancak
 * testle görülüyor.
 */

/**
 * Değeri günlüğe yazılmadan önce ayıklanacak alan adları.
 *
 * Eşleşme parça bazlı: 'password', 'newPassword', 'api_key' hepsi yakalanır.
 * Beyaz liste yerine kara liste bilinçli — payload'ların çoğu zararsız ve
 * asıl değer onların görünmesinde; sır taşıyan alan adları ise sayılı.
 */
const SIR_ALANLARI = [
  'password',
  'pass',
  'token',
  'secret',
  'authorization',
  'cookie',
  'session',
  'apikey',
  'api_key',
  'client_secret',
  'refresh_token',
  'access_token',
];

const MASKE = '***';
/** Tek bir metin alanının günlükte kaplayacağı üst sınır. */
const METIN_TAVANI = 500;
/** İç içe nesnelerde inilecek en derin seviye. */
const DERINLIK_TAVANI = 4;

function sirMi(anahtar: string): boolean {
  const k = anahtar.toLowerCase().replace(/[_-]/g, '');
  return SIR_ALANLARI.some((s) => k.includes(s.replace(/[_-]/g, '')));
}

/**
 * Girdiyi günlüğe yazılabilir hâle getirir: sır alanlarını maskeler,
 * uzun metinleri kırpar, derin yapıları düzleştirir.
 */
export function sirTemizle(deger: unknown, derinlik = 0): unknown {
  if (deger === null || deger === undefined) return null;
  if (typeof deger === 'string') {
    return deger.length > METIN_TAVANI ? `${deger.slice(0, METIN_TAVANI)}…` : deger;
  }
  if (typeof deger === 'number' || typeof deger === 'boolean') return deger;
  if (derinlik >= DERINLIK_TAVANI) return '[derin]';
  if (Array.isArray(deger)) {
    // İlk 20 eleman yeterli: uzun listelerde önemli olan ne olduğu, hepsi değil.
    const kirpik = deger.slice(0, 20).map((v) => sirTemizle(v, derinlik + 1));
    return deger.length > 20 ? [...kirpik, `…+${deger.length - 20}`] : kirpik;
  }
  if (typeof deger === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(deger as Record<string, unknown>)) {
      out[k] = sirMi(k) ? MASKE : sirTemizle(v, derinlik + 1);
    }
    return out;
  }
  return null;
}

export interface IstekOzeti {
  method: string;
  /** Fastify rota kalıbı; yoksa ham yol. */
  route: string | undefined;
  url: string;
  statusCode: number;
  /** Oturum çözüldü mü — yetkisiz istekleri ayırt etmek için. */
  oturumVar: boolean;
}

export interface KayitKarari {
  kaydet: boolean;
  action: string;
  category: ActivityCategory;
  actorType: ActorType;
}

/** Yazma sayılan metotlar — bunlar koşulsuz kayda düşer. */
const YAZMA_METOTLARI = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Hiç kayda değmeyen yollar.
 *
 * Sağlık kontrolü saniyede bir gelebiliyor ve hiçbir soruya cevap
 * vermiyor; tek başına günlüğün tamamını doldururdu.
 */
function gurultuMu(yol: string): boolean {
  if (yol.startsWith('/api/health') || yol === '/favicon.ico') return true;
  // Oturum yoklaması: web her sayfa yüklemesinde çağırıyor ve giriş
  // yapmamış ziyaretçide 401 dönüyor. Kendi oturumunu sormak bir erişim
  // denemesi değil; kayda geçseydi günlüğün çoğunluğu bu satır olurdu.
  if (yol === '/api/auth/me') return true;
  return false;
}

/** Token'ı yolda taşıyan, oyun sunucusunun çektiği listeler. */
function makineListesiMi(yol: string): boolean {
  return yol.includes('/ban-list/') || yol.includes('/admin-list/');
}

/**
 * Bir isteğin günlüğe yazılıp yazılmayacağına ve nasıl etiketleneceğine
 * karar verir.
 *
 * Kural sırası önemli: gürültü elenir, makine çekişleri ayrılır, ardından
 * "yazma mı, yetkisizlik mi, oturumlu okuma mı" bakılır. Oturumsuz ve
 * başarılı GET'ler (giriş sayfası, statik uçlar) yazılmaz — kimliği
 * olmayan birinin herkese açık bir sayfayı görmesi kimseye hesap
 * sordurmuyor.
 */
export function kayitKarari(o: IstekOzeti): KayitKarari {
  const yol = o.route ?? o.url;
  const hayir: KayitKarari = {
    kaydet: false,
    action: 'http.request',
    category: 'sistem',
    actorType: 'anonymous',
  };

  if (o.method === 'OPTIONS' || o.method === 'HEAD') return hayir;
  if (gurultuMu(yol)) return hayir;

  if (makineListesiMi(yol)) {
    return {
      kaydet: true,
      action: yol.includes('/ban-list/') ? 'ban_list.fetch' : 'admin_list.fetch',
      category: 'sistem',
      actorType: 'game_server',
    };
  }

  const aktor: ActorType = o.oturumVar ? 'user' : 'anonymous';

  // Yetki reddi her hâlükârda kayda değer: kim nereye girmeye çalıştı.
  if (o.statusCode === 401 || o.statusCode === 403) {
    return { kaydet: true, action: 'access.denied', category: 'oturum', actorType: aktor };
  }

  if (YAZMA_METOTLARI.has(o.method)) {
    return {
      kaydet: true,
      action: `http.${o.method.toLowerCase()}`,
      category: 'moderasyon',
      actorType: aktor,
    };
  }

  if (o.oturumVar) {
    return { kaydet: true, action: 'http.get', category: 'okuma', actorType: 'user' };
  }

  // Oturumsuz okuma: yalnızca hata döndüyse (ör. 500) iz bırakıyor.
  if (o.statusCode >= 500) {
    return { kaydet: true, action: 'http.error', category: 'sistem', actorType: aktor };
  }

  return hayir;
}

/** Yolu günlüğe yazmadan önce maskele — token'lar yol parçasında geliyor. */
export function gunlukYolu(url: string): string {
  return redactUrl(url);
}
