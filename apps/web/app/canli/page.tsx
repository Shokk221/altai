import { LiveDashboard } from '@/components/live-dashboard';
import { getMe, publicApiUrl } from '@/lib/api';
import Link from 'next/link';

export const metadata = { title: 'Canlı — Altai' };

/**
 * Canlı ekran.
 *
 * WebSocket adresi api'nin adresinden türetiliyor: WS kökte (`/ws`), HTTP
 * rotaları `/api` önekinde — ters vekil öneki soymuyor, o yüzden ekini
 * kaldırıp `/ws` ekliyoruz.
 */
function wsAdresi(): string {
  const http = publicApiUrl();
  const koken = http.replace(/\/api$/, '');
  return `${koken.replace(/^http/, 'ws')}/ws`;
}

export default async function CanliPage() {
  const me = await getMe();
  if (!me) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
        <h1 className="display text-2xl">Giriş gerekli</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Canlı ekranda oyuncu isimleri ve mesajlar akıyor; giriş yapmadan görünmez.
        </p>
        <Link href="/" className="mt-5 inline-block text-sm font-semibold text-accent">
          Girişe dön
        </Link>
      </main>
    );
  }

  return <LiveDashboard wsUrl={wsAdresi()} />;
}
