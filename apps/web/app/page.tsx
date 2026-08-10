import { BreakGlassLogin } from '@/components/break-glass-login';
import { LiveDashboard } from '@/components/live-dashboard';
import { getMe, publicApiUrl } from '@/lib/api';

/**
 * Kök sayfa.
 *
 * Girişliyse doğrudan KONTROL PANELİ açılıyor. Önce burada bir karşılama
 * ekranı vardı ("Oyuncuları ara" düğmesi) — panele giren birinin ilk
 * gördüğü şey bir düğme değil, sunucunun o anki hâli olmalı.
 *
 * Girişsizse giriş ekranı; yönlendirme yapmıyoruz, aynı adres iki durumu da
 * karşılıyor.
 */

/**
 * WebSocket kökte (`/ws`), HTTP rotaları `/api` önekinde — ters vekil öneki
 * soymuyor, o yüzden eki kaldırıp `/ws` ekliyoruz.
 */
function wsAdresi(): string {
  const koken = publicApiUrl().replace(/\/api$/, '');
  return `${koken.replace(/^http/, 'ws')}/ws`;
}

export default async function HomePage() {
  const me = await getMe();
  const apiUrl = publicApiUrl();

  if (me) return <LiveDashboard wsUrl={wsAdresi()} />;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col items-center justify-center gap-6 px-5 py-12">
      <div className="text-center">
        <h1 className="display text-4xl">Altai</h1>
        <p className="mt-2 text-sm text-fg-muted">Sunucu yönetim paneli</p>
      </div>

      <div className="flex w-full flex-col items-center gap-4 rounded border border-border bg-surface px-6 py-7">
        <a
          href={`${apiUrl}/auth/discord`}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-ink px-5 text-sm font-medium text-ink-fg transition-colors hover:bg-accent-2"
        >
          Discord ile giriş yap
        </a>
        <BreakGlassLogin apiUrl={apiUrl} />
      </div>
    </main>
  );
}
