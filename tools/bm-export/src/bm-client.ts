import { logger } from '@altai/shared';

export const BM_BASE_URL = 'https://api.battlemetrics.com';

export class BmHttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    readonly body: string,
  ) {
    super(`BM API ${status} — ${url}\n${body.slice(0, 500)}`);
    this.name = 'BmHttpError';
  }
}

/** JSON:API kaynağı — ham arşivde olduğu gibi saklanır, şema doğrulaması yapılmaz. */
export interface BmResource {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

export interface BmPage {
  data: BmResource[];
  /** include= ile gelen yan kaynaklar (identifier, server, playerFlag...). */
  included: BmResource[];
  /** links.next — sayfalamada bir sonraki adım. Yoksa kaynak bitmiştir. */
  nextUrl: string | null;
}

export interface BmClientOptions {
  token: string;
  /**
   * Saniyede en fazla kaç istek. BM'nin gerçek limiti abonelik planına göre
   * değişir ve dokümante edilmemiştir; muhafazakâr başlanır, 429 gelirse
   * zaten global olarak yavaşlarız (bkz. RateLimiter.penalize).
   */
  requestsPerSecond?: number;
  maxRetries?: number;
  /**
   * Tek istek için üst sınır. Zaman aşımı olmadan asılı kalan tek bir bağlantı
   * saatler süren arşivi süresiz durdurur — fetch'in kendiliğinden zaman
   * aşımı yoktur.
   */
  timeoutMs?: number;
  /** Testte sahte BM sunucusuna yönlendirmek için; üretimde verilmez. */
  baseUrl?: string;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Süreç genelinde tek limitleyici. Paralel işçiler (per-player fan-out) aynı
 * instance'ı paylaşır — biri 429 yerse penalize() ile hepsi birden yavaşlar,
 * yoksa işçiler sırayla 429 yiyip limiti daha da kötüleştirir.
 */
class RateLimiter {
  private nextSlotAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  async acquire(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + this.minIntervalMs;
    const waitMs = slot - now;
    if (waitMs > 0) await sleep(waitMs);
  }

  penalize(ms: number): void {
    this.nextSlotAt = Math.max(this.nextSlotAt, Date.now() + ms);
  }
}

const RETRYABLE_STATUSES = new Set([408, 425, 500, 502, 503, 504]);

export class BmClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly limiter: RateLimiter;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private requestCount = 0;

  constructor(opts: BmClientOptions) {
    this.token = opts.token;
    this.baseUrl = opts.baseUrl ?? BM_BASE_URL;
    const rps = opts.requestsPerSecond ?? 4;
    this.limiter = new RateLimiter(Math.ceil(1000 / rps));
    this.maxRetries = opts.maxRetries ?? 6;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  get totalRequests(): number {
    return this.requestCount;
  }

  /**
   * Tek istek. 429 ve geçici 5xx'lerde yeniden dener; 401/403/404'te hemen
   * fırlatır (yeniden denemek anlamsız, sadece limit yakar — çağıran bu
   * durumları "bu uç bizim token'a kapalı" olarak raporlar).
   */
  async get(pathOrUrl: string, params: Record<string, string> = {}): Promise<BmPage> {
    const url = pathOrUrl.startsWith('http')
      ? new URL(pathOrUrl)
      : new URL(pathOrUrl, this.baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const href = url.toString();

    for (let attempt = 0; ; attempt++) {
      await this.limiter.acquire();
      this.requestCount++;

      let res: Response;
      try {
        res = await fetch(href, {
          headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (cause) {
        // Ağ hatası (DNS, socket reset, zaman aşımı) — 5xx gibi davran.
        if (attempt >= this.maxRetries) throw cause;
        const waitMs = this.backoffMs(attempt);
        logger.warn({ url: href, attempt, waitMs, cause }, 'BM ağ hatası — yeniden denenecek');
        await sleep(waitMs);
        continue;
      }

      if (res.status === 429) {
        if (attempt >= this.maxRetries) {
          throw new BmHttpError(429, href, 'rate limit: yeniden deneme hakkı bitti');
        }
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : this.backoffMs(attempt);
        // Global ceza: diğer paralel işçiler de bu süre kadar bekler.
        this.limiter.penalize(waitMs);
        logger.warn({ url: href, waitMs }, 'BM rate limit — tüm istekler yavaşlatılıyor');
        await sleep(waitMs);
        continue;
      }

      if (RETRYABLE_STATUSES.has(res.status)) {
        if (attempt >= this.maxRetries) {
          throw new BmHttpError(res.status, href, await res.text());
        }
        const waitMs = this.backoffMs(attempt);
        logger.warn(
          { url: href, status: res.status, waitMs },
          'BM geçici hata — yeniden denenecek',
        );
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) throw new BmHttpError(res.status, href, await res.text());

      // BM her cevapta kalan kotayı bildiriyor (x-rate-limit-limit: 300/dk).
      // Kota tükenmeye yaklaşınca 429'u beklemeden yavaşlıyoruz — saatler süren
      // bir çekimde 429'a çarpıp geri çekilmek, baştan yavaşlamaktan pahalı.
      const remaining = Number(res.headers.get('x-rate-limit-remaining'));
      const limit = Number(res.headers.get('x-rate-limit-limit'));
      if (Number.isFinite(remaining) && Number.isFinite(limit) && limit > 0) {
        if (remaining < limit * 0.1) {
          this.limiter.penalize(10_000);
          logger.warn({ remaining, limit }, 'BM kotası azaldı — 10 sn yavaşlatılıyor');
        } else if (remaining < limit * 0.25) {
          this.limiter.penalize(2_000);
        }
      }

      const body = (await res.json()) as {
        data?: BmResource[] | BmResource;
        included?: BmResource[];
        links?: { next?: string };
      };

      // Tekil kaynak uçları (örn. /servers/{id}) dizi yerine tek nesne döner.
      const data = Array.isArray(body.data) ? body.data : body.data ? [body.data] : [];

      // Cursor olarak sadece yol+sorgu saklanır. links.next mutlak URL döner ama
      // onu olduğu gibi manifest'e yazmak arşivi host'a mıhlar — devam eden bir
      // çekim, base URL değişirse (veya arşiv başka ortamda sürdürülürse)
      // ulaşılamayan bir adrese gitmeye çalışırdı.
      let nextUrl: string | null = null;
      if (body.links?.next) {
        const next = new URL(body.links.next, this.baseUrl);
        nextUrl = `${next.pathname}${next.search}`;
      }

      return { data, included: body.included ?? [], nextUrl };
    }
  }

  private backoffMs(attempt: number): number {
    // Üstel + jitter (aynı anda uyanıp yeniden 429 yememek için).
    const base = Math.min(2 ** attempt * 1000, 60_000);
    return base + Math.floor(Math.random() * 500);
  }

  /**
   * Kaynağı sayfa sayfa gezer. Cursor olarak `links.next` URL'sinin tamamı
   * kullanılır — page[key]'i ayrıştırıp yeniden kurmaktansa BM'nin verdiği
   * linki olduğu gibi izlemek JSON:API'ye uygun ve uçtan uca daha sağlam
   * (bazı uçlar page[rel]/page[size] gibi ek alanlar da taşır).
   */
  async *paginate(
    path: string,
    params: Record<string, string> = {},
    resumeUrl?: string,
  ): AsyncGenerator<BmPage> {
    let next = resumeUrl;

    for (;;) {
      const page: BmPage = next ? await this.get(next) : await this.get(path, params);
      yield page;

      if (!page.nextUrl) return;
      // Sonsuz döngü koruması: bazı uçlar boş sayfada bile next verebiliyor.
      if (page.data.length === 0) {
        logger.warn({ path }, 'boş sayfa ama next link var — sayfalama durduruldu');
        return;
      }
      next = page.nextUrl;
    }
  }
}
