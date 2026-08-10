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

/** Tarayıcının kullanacağı adres (mutlak, dışarıdan erişilebilir). */
export function publicApiUrl(): string {
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
  const res = await fetchAuth(path);
  if (!res) return null;
  if (res.status === 404) return undefined;
  if (!res.ok) return null;
  return (await res.json()) as T;
}
