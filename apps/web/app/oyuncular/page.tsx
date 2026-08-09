import { PlayerSearch } from '@/components/player-search';

export const metadata = { title: 'Oyuncular — Altai' };

export default function PlayersPage() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Oyuncular</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Arama isim geçmişini de kapsar — oyuncunun bugün kullanmadığı bir isimle de bulunur.
        </p>
      </header>
      <PlayerSearch apiUrl={apiUrl} />
    </main>
  );
}
