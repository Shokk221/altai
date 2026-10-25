import { cookies } from 'next/headers';

/**
 * Sunucu bileşenlerinden api'ye kimlikli istek.
 *
 * Oturum çerezi HttpOnly, yani tarayıcı JS'i göremiyor; sunucu tarafında
 * elle iletmek zorundayız. Bu üç sayfada tekrarlanıyordu, tek yere alındı.
 */

export const SESSION_COOKIE = 'altai_session';

function temizle(raw?: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/**
 * DEMO KİPİ — api ve Discord olmadan paneli gezmek için.
 *
 * NEDEN VAR: panel Postgres + api + Discord OAuth olmadan açılmıyor.
 * Lokalde bu üçünü kurmadan hiçbir sayfa görülemiyordu; her rota "Giriş
 * gerekli" kapısına düşüyordu ve tasarıma bakmak imkânsızdı.
 *
 * `ALTAI_DEMO=1` verildiğinde `getMe` sahte bir süper admin, `getJson` de
 * src/fixtures/ornek.ts'teki örnek veriyi döndürüyor. Ağa hiç çıkılmıyor.
 *
 * ÜRETİMDE AÇILAMAZ: `NODE_ENV === 'production'` olduğunda bayrak ne
 * olursa olsun yok sayılıyor. Bu bir kimlik doğrulama atlaması ve
 * üretimde erişilebilir olması panelin tamamını açığa çıkarırdı; o yüzden
 * kontrol tek bir yerde ve derleme kipine bağlı, yalnızca ortam
 * değişkenine değil.
 */
export function demoKipi(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ALTAI_DEMO === '1';
}

/** Tarayıcının kullanacağı adres (mutlak, dışarıdan erişilebilir). */
export function publicApiUrl(): string {
  // Demo kipinde tarayıcı da aynı örnek veriyi görsün diye istekler
  // panelin kendi sahte ucuna gidiyor (app/demo-api). Mutlak adres:
  // canlı panel bundan WebSocket adresini türetiyor ve göreli bir yol
  // `new WebSocket()` çağrısını hata fırlatarak düşürüyor.
  if (demoKipi()) {
    return `${temizle(process.env.ALTAI_DEMO_ORIGIN) ?? 'http://localhost:3000'}/demo-api`;
  }
  return (
    temizle(process.env.SERVER_PUBLIC_URL) ??
    temizle(process.env.NEXT_PUBLIC_API_URL) ??
    'http://localhost:3001'
  );
}

/** Sunucu bileşenlerinin kullanacağı adres (konteyner içi kısa yol). */
export function internalApiUrl(): string {
  return temizle(process.env.API_INTERNAL_URL) ?? publicApiUrl();
}

export interface Me {
  id: string;
  discordUsername: string;
  systemRole: string;
  permissions: string[];
  isBreakGlass: boolean;
}

const DEMO_ME: Me = {
  id: 'u-demo',
  discordUsername: 'yalnizkurt',
  systemRole: 'super_admin',
  permissions: [],
  isBreakGlass: false,
};

async function fetchAuth(path: string): Promise<Response | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await fetch(`${internalApiUrl()}${path}`, {
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      cache: 'no-store',
    });
  } catch {
    return null;
  }
}

export async function getMe(): Promise<Me | null> {
  if (demoKipi()) return DEMO_ME;
  const res = await fetchAuth('/auth/me');
  if (!res?.ok) return null;
  return (await res.json()) as Me;
}

/**
 * Oturumlu GET. `null` = oturum yok ya da yetki yok, `undefined` = bulunamadı.
 * İkisini ayırıyoruz: sayfa "giriş yapın" ile "böyle bir oyuncu yok" arasında
 * farklı davranmalı.
 */
export async function getJson<T>(path: string): Promise<T | null | undefined> {
  if (demoKipi()) {
    // Dinamik import: örnek veri yalnızca demo kipinde yükleniyor,
    // üretim paketine girmiyor.
    const { demoCevap } = await import('@/fixtures/demo-api');
    return demoCevap<T>(path);
  }
  const res = await fetchAuth(path);
  if (!res) return null;
  if (res.status === 404) return undefined;
  if (!res.ok) return null;
  return (await res.json()) as T;
}
