import { BreakGlassLogin } from '@/components/break-glass-login';
import { LogoutButton } from '@/components/logout-button';

interface Me {
  id: string;
  discordUsername: string;
  systemRole: string;
  permissions: string[];
  isBreakGlass: boolean;
}

async function getMe(apiUrl: string): Promise<Me | null> {
  try {
    const res = await fetch(`${apiUrl}/auth/me`, { credentials: 'include', cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as Me;
  } catch {
    return null;
  }
}

export default async function HomePage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const me = await getMe(apiUrl);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4">
      {me ? (
        <>
          <p>
            Giriş yapıldı: {me.discordUsername} ({me.systemRole}
            {me.isBreakGlass ? ' — break-glass' : ''})
          </p>
          <LogoutButton apiUrl={apiUrl} />
        </>
      ) : (
        <>
          <a href={`${apiUrl}/auth/discord`} className="rounded bg-indigo-600 px-4 py-2 text-white">
            Discord ile giriş yap
          </a>
          <BreakGlassLogin apiUrl={apiUrl} />
        </>
      )}
    </main>
  );
}
