import { PlayerSearch } from '@/components/player-search';
import { publicApiUrl } from '@/lib/api';
import Link from 'next/link';

export const metadata = { title: 'Oyuncular — Altai' };

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const apiUrl = publicApiUrl();
  // Canlı ekrandan gelen bağlantılar SteamID ile geliyor; arama kutusu
  // dolu açılsın ve sonuç hemen gelsin.
  const { q } = await searchParams;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-6">
      <header className="mb-5">
        <h1 className="display text-3xl">Oyuncular</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Arama isim geçmişini de kapsar — oyuncunun bugün kullanmadığı bir isimle de bulunur.
        </p>
      </header>
      <PlayerSearch apiUrl={apiUrl} ilkSorgu={q ?? ''} />
    </main>
  );
}
