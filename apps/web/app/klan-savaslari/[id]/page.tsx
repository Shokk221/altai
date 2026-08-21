import {
  type KadroSatiri,
  type Klan,
  KlanSavasi,
  type Savas,
  type Takim,
} from '@/components/klan-savasi';
import { getJson, getMe, publicApiUrl } from '@/lib/api';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Klan savaşı — Altai' };

export default async function KlanSavasiPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();

  if (!me) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
        <h1 className="display text-2xl">Giriş gerekli</h1>
        <Link href="/" className="mt-5 inline-block text-sm font-semibold text-accent">
          Girişe dön
        </Link>
      </main>
    );
  }

  const [veri, klanVeri] = await Promise.all([
    getJson<{ war: Savas; takimlar: Takim[]; kadro: KadroSatiri[] }>(`/clan-wars/${id}`),
    getJson<{ clans: Klan[] }>('/clans'),
  ]);

  if (veri === undefined) notFound();
  if (!veri) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
        <h1 className="display text-2xl">Savaş yüklenemedi</h1>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-6">
      <Link href="/klan-savaslari" className="text-xs font-semibold text-fg-muted hover:text-fg">
        ← Klan savaşları
      </Link>
      <div className="mt-3">
        <KlanSavasi
          apiUrl={publicApiUrl()}
          savas={veri.war}
          takimlar={veri.takimlar}
          kadro={veri.kadro}
          klanlar={klanVeri?.clans ?? []}
        />
      </div>
    </main>
  );
}
