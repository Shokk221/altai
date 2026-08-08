import { BreakGlassLogin } from '@/components/break-glass-login';
import { LogoutButton } from '@/components/logout-button';
import { cookies } from 'next/headers';

interface Me {
  id: string;
  discordUsername: string;
  systemRole: string;
  permissions: string[];
  isBreakGlass: boolean;
}

const SESSION_COOKIE = 'altai_session';

async function getMe(apiUrl: string): Promise<Me | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;
    if (!token) return null;

    const res = await fetch(`${apiUrl}/auth/me`, {
      // We must forward the HttpOnly session cookie to the API from the server.
      headers: { Cookie: `${SESSION_COOKIE}=${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as Me;
  } catch {
    return null;
  }
}

function cleanBaseUrl(raw?: string): string | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function getPublicApiUrl(): string {
  return (
    cleanBaseUrl(process.env.SERVER_PUBLIC_URL) ??
    cleanBaseUrl(process.env.NEXT_PUBLIC_API_URL) ??
    'http://localhost:3001'
  );
}

function getInternalApiUrl(): string {
  return cleanBaseUrl(process.env.API_INTERNAL_URL) ?? getPublicApiUrl();
}

export default async function HomePage() {
  const publicApiUrl = getPublicApiUrl();
  const internalApiUrl = getInternalApiUrl();
  const me = await getMe(internalApiUrl);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4">
      {me ? (
        <>
          <p>
            Giriş yapıldı: {me.discordUsername} (
            {me.isBreakGlass ? `${me.systemRole} - break-glass` : me.systemRole})
          </p>
          <LogoutButton apiUrl={publicApiUrl} />
        </>
      ) : (
        <>
          <a
            href={`${publicApiUrl}/auth/discord`}
            className="rounded bg-indigo-600 px-4 py-2 text-white"
          >
            Discord ile giriş yap
          </a>
          <BreakGlassLogin apiUrl={publicApiUrl} />
        </>
      )}
    </main>
  );
}
