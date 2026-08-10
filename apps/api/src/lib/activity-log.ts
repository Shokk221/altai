import type { ActivityCategory, ActorType, Db } from '@altai/db';
import { activitySchema } from '@altai/db';
import { logger } from '@altai/shared';

/**
 * Sistem günlüğü yazıcısı.
 *
 * İki yazma yolu var ve ikisi de bilerek farklı:
 *
 *   kaydet()   — tamponlu, ateşle-unut. HTTP kancası her istekte çağırıyor;
 *                yanıtı bekletmemesi gerekiyor. En fazla 2 saniyelik ya da
 *                200 satırlık gecikmeyle toplu yazılıyor.
 *   kaydetTx() — çağıranın transaction'ı içinde, senkron. Moderasyon
 *                eylemleri bunu kullanıyor: eylem başarılı olup kaydı
 *                düşerse "bunu kim yaptı" sorusunun cevabı kaybolur.
 *
 * Yazıcı HİÇBİR koşulda hata fırlatmaz. Günlük tutamamak kötü; günlük
 * tutamadığı için ban'ı geri almak daha kötü.
 */

const BOSALTMA_ARALIGI_MS = 2_000;
const BOSALTMA_TAVANI = 200;

/**
 * Tampon üst sınırı. Postgres cevap vermezken tampon sınırsız büyürse
 * süreç belleği tüketir — günlük yüzünden api'nin ölmesi kabul edilemez.
 * Dolduğunda en ESKİLER atılır ve kaç satırın düştüğü bir kez loglanır.
 */
const TAMPON_TAVANI = 5_000;

export interface ActivityEntry {
  actorType: ActorType;
  actorUserId?: string | null;
  actorLabel?: string | null;
  action: string;
  category: ActivityCategory;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  method?: string | null;
  path?: string | null;
  route?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  payload?: Record<string, unknown> | null;
  requestId?: string | null;
}

type Satir = typeof activitySchema.activityLog.$inferInsert;

function satirlastir(e: ActivityEntry): Satir {
  return {
    actorType: e.actorType,
    actorUserId: e.actorUserId ?? null,
    actorLabel: e.actorLabel ?? null,
    action: e.action,
    category: e.category,
    targetType: e.targetType ?? null,
    targetId: e.targetId ?? null,
    targetLabel: e.targetLabel ?? null,
    method: e.method ?? null,
    path: e.path ?? null,
    route: e.route ?? null,
    statusCode: e.statusCode ?? null,
    durationMs: e.durationMs ?? null,
    ip: e.ip ?? null,
    userAgent: e.userAgent ?? null,
    payload: e.payload ?? null,
    requestId: e.requestId ?? null,
  };
}

let db: Db | null = null;
let tampon: Satir[] = [];
let zamanlayici: NodeJS.Timeout | null = null;
let dusen = 0;

/** api açılışında bir kez çağrılır. Öncesindeki kayıtlar sessizce düşer. */
export function activityLogBaslat(veritabani: Db) {
  db = veritabani;
  if (!zamanlayici) {
    zamanlayici = setInterval(() => {
      void bosalt();
    }, BOSALTMA_ARALIGI_MS);
    // Tek başına kalan bu zamanlayıcı süreci ayakta tutmasın.
    zamanlayici.unref?.();
  }
}

/** Tamponlu yazım. Asla hata fırlatmaz, asla beklenmez. */
export function kaydet(entry: ActivityEntry) {
  if (!db) return;
  tampon.push(satirlastir(entry));
  if (tampon.length > TAMPON_TAVANI) {
    dusen += tampon.length - TAMPON_TAVANI;
    tampon = tampon.slice(-TAMPON_TAVANI);
  }
  if (tampon.length >= BOSALTMA_TAVANI) void bosalt();
}

/**
 * Anlamlı kayıt yazılmış isteklerin kimlikleri.
 *
 * Bir ban isteği iki satır üretebilirdi: kancanın yazdığı genel
 * "POST /api/moderation/bans" ve writeAudit'in yazdığı "ban.create".
 * İkincisi kimin kime ne kadar süreyle ban attığını söylüyor, birincisi
 * yalnızca bir adres — ekranda yan yana durunca günlük iki katına çıkıp
 * okunmaz hâle geliyordu. Anlamlı satır varsa genel satır yazılmıyor.
 *
 * Başarısız istekler (doğrulama hatası, yetki reddi) anlamlı satır
 * üretmiyor; onlar genel satırla kayda geçmeye devam ediyor — ki asıl
 * merak edilen de o denemeler.
 */
const anlamliKayitlar = new Set<string>();
/** Yanıtı hiç tamamlanmayan istekler için üst sınır — sızıntı olmasın. */
const ANLAMLI_TAVANI = 1_000;

/** writeAudit çağırır: bu isteğin genel satırı artık gereksiz. */
export function anlamliIsaretle(requestId: string) {
  if (anlamliKayitlar.size > ANLAMLI_TAVANI) anlamliKayitlar.clear();
  anlamliKayitlar.add(requestId);
}

/** HTTP kancası çağırır; işareti okur ve tüketir. */
export function anlamliTuket(requestId: string): boolean {
  return anlamliKayitlar.delete(requestId);
}

/** Transaction handle'ı: db.transaction(async (tx) => ...) içindeki `tx`. */
type TxLike = Pick<Db, 'insert'>;

/**
 * Çağıranın transaction'ı içinde yazar. Eylem geri alınırsa kayıt da geri
 * alınır — olmamış bir ban'ın günlükte durması yanlış bilgi olurdu.
 */
export async function kaydetTx(tx: TxLike, entry: ActivityEntry) {
  try {
    await tx.insert(activitySchema.activityLog).values(satirlastir(entry));
  } catch (err) {
    logger.error({ err, action: entry.action }, 'activity_log tx yazımı başarısız');
  }
}

async function bosalt() {
  if (!db || tampon.length === 0) return;
  const parti = tampon;
  tampon = [];
  if (dusen > 0) {
    logger.warn({ dusen }, 'activity_log tamponu taştı, eski satırlar atıldı');
    dusen = 0;
  }
  try {
    await db.insert(activitySchema.activityLog).values(parti);
  } catch (err) {
    // Geri koymuyoruz: hata kalıcıysa (şema uyuşmazlığı) sonsuza kadar
    // aynı partiyi deneyip her turda yeniden hata basardık.
    logger.error({ err, satir: parti.length }, 'activity_log yazımı başarısız');
  }
}

/** Kapanışta bekleyenleri boşalt. */
export async function activityLogDurdur() {
  if (zamanlayici) {
    clearInterval(zamanlayici);
    zamanlayici = null;
  }
  await bosalt();
}

/** Sadece testler için: modül durumunu sıfırlar. */
export function activityLogSifirla() {
  tampon = [];
  dusen = 0;
  db = null;
  if (zamanlayici) {
    clearInterval(zamanlayici);
    zamanlayici = null;
  }
}
