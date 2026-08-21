import { type Kural, Kurallar } from '@/components/kurallar';
import { getJson, getMe, publicApiUrl } from '@/lib/api';
import Link from 'next/link';

export const metadata = { title: 'Kurallar — Altai' };

/**
 * Kural yönetimi — plan Faz 5.
 *
 * Buradaki metin tek kaynak: oyun içi `!kurallar` komutu da bunu okuyor.
 * Pasif kurallar da listeleniyor (`?all=1`) çünkü düzenleyen kişi neyin
 * kaldırıldığını görebilmeli — oyun içi liste yalnızca aktifleri gösteriyor.
 */
export default async function KurallarPage() {
  const me = await getMe();
  const apiUrl = publicApiUrl();

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

  const veri = await getJson<{ rules: Kural[] }>('/rules?all=1');

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-6">
      <header className="mb-5">
        <h1 className="display text-3xl">Kurallar</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Buradaki metin tek kaynak — oyun içi <code>!kurallar</code> komutu da bunu gösteriyor.
          Kaldırılan kural silinmez, pasife alınır: geçmiş moderasyon kayıtları kurallara atıfta
          bulunuyor.
        </p>
      </header>

      <Kurallar apiUrl={apiUrl} kurallar={veri?.rules ?? []} />
    </main>
  );
}
