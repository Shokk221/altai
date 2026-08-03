import { logger } from '@altai/shared';

const BM_BASE_URL = 'https://api.battlemetrics.com';

export interface BmPage<T> {
  data: T[];
  nextCursor: string | null;
}

// BM, sayfalamayı page[key] cursor'ı ile yapar (offset değil — büyük veri
// setlerinde offset pahalı/kararsız olur). 429 aldığında Retry-After'a uyar,
// yoksa üstel geri çekilme uygular.
export async function fetchBmPage<T>(
  path: string,
  token: string,
  params: Record<string, string> = {},
  attempt = 0,
): Promise<BmPage<T>> {
  const url = new URL(path, BM_BASE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 429) {
    if (attempt >= 5) throw new Error(`BM rate limit: 5 deneme sonrası hâlâ 429 (${url})`);
    const retryAfterHeader = res.headers.get('retry-after');
    const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 2 ** attempt * 1000;
    logger.warn({ url: url.toString(), waitMs }, 'BM rate limit — bekleniyor');
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return fetchBmPage<T>(path, token, params, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`BM API hatası ${res.status}: ${url} — ${await res.text()}`);
  }

  const body = (await res.json()) as {
    data: T[];
    links?: { next?: string };
  };

  let nextCursor: string | null = null;
  if (body.links?.next) {
    const nextUrl = new URL(body.links.next, BM_BASE_URL);
    nextCursor = nextUrl.searchParams.get('page[key]');
  }

  return { data: body.data, nextCursor };
}

// path'teki kaynağı baştan sona (veya verilen cursor'dan devam ederek) çeker,
// her sayfayı geldikçe onPage'e verir — çağıran diske/DB'ye yazmaktan sorumlu.
// Böylece süreç yarıda kesilirse (Ctrl+C, ağ hatası) zaten yazılmış sayfalar
// kaybolmaz.
export async function fetchBmResource<T>(
  path: string,
  token: string,
  baseParams: Record<string, string>,
  onPage: (page: T[], cursor: string | null) => Promise<void>,
  resumeFromCursor?: string,
): Promise<number> {
  let cursor = resumeFromCursor;
  let total = 0;

  for (;;) {
    const params = { ...baseParams };
    if (cursor) params['page[key]'] = cursor;

    const page = await fetchBmPage<T>(path, token, params);
    await onPage(page.data, page.nextCursor);
    total += page.data.length;

    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }

  return total;
}
