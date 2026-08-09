import { BreakGlassLogin } from '@/components/break-glass-login';
import { LogoutButton } from '@/components/logout-button';
import { cookies } from 'next/headers';
import Link from 'next/link';

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
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-12">
      <div className="text-center">
        <h1 className="display text-4xl">Altai</h1>
        <p className="mt-2 text-sm text-fg-muted">Sunucu yönetim paneli</p>
      </div>

      {me ? (
        <div className="flex w-full flex-col items-center gap-4 rounded bg-surface px-6 py-7">
          <div className="text-center">
            <p className="font-semibold">{me.discordUsername}</p>
            <p className="mt-1 text-sm text-fg-muted">
              {me.systemRole}
              {me.isBreakGlass ? ' · acil giriş' : ''}
            </p>
          </div>
          <Link
            href="/oyuncular"
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-ink px-5 text-sm font-semibold text-ink-fg transition-colors hover:bg-ink/90"
          >
            Oyuncuları ara
          </Link>
          <LogoutButton apiUrl={publicApiUrl} />
        </div>
      ) : (
        <div className="flex w-full flex-col items-center gap-4 rounded bg-surface px-6 py-7">
          <a
            href={`${publicApiUrl}/auth/discord`}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-ink px-5 text-sm font-semibold text-ink-fg transition-colors hover:bg-ink/90"
          >
            Discord ile giriş yap
          </a>
          <BreakGlassLogin apiUrl={publicApiUrl} />
        </div>
      )}
    </main>
  );
}
