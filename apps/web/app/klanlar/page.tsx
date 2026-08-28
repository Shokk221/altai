import { type Klan, Klanlar } from '@/components/klanlar';
import { getJson, getMe, publicApiUrl } from '@/lib/api';
import Link from 'next/link';

export const metadata = { title: 'Klanlar — Altai' };

export default async function KlanlarPage() {
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

  // Klan üyeliği takım dengelemesini etkiliyor — sunucu kontrolü yetkisi,
  // moderasyon değil. api ucu da aynı izni arıyor.
  // İKİ izinden biri yetiyor — api tarafındaki guard ile aynı kural.
  // Ayrışırlarsa, uçtan veri alabilen ama sayfayı göremeyen bir kullanıcı
  // ortaya çıkıyor.
  const yetkili =
    me.permissions.includes('plugin_config.write') ||
    me.permissions.includes('clan.manage') ||
    me.systemRole === 'super_admin';
  if (!yetkili) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
        <h1 className="display text-2xl">Yetkiniz yok</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Klanları yönetmek için <code>plugin_config.write</code> ya da <code>clan.manage</code>{' '}
          izni gerekiyor.
        </p>
        <Link href="/oyuncular" className="mt-5 inline-block text-sm font-semibold text-accent">
          Oyunculara dön
        </Link>
      </main>
    );
  }

  const veri = await getJson<{ clans: Klan[] }>('/clans');

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8">
      <header className="mb-6">
        <h1 className="display text-3xl">Klanlar</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Üyelik SteamID listesiyle yönetiliyor. Takım dengeleyici klan üyelerini aynı tarafta
          tutmak için burayı okuyor; rakip olarak tanımlanan klanları da ayrı taraflarda tutuyor.
        </p>
      </header>

      {veri ? (
        <Klanlar apiUrl={publicApiUrl()} klanlar={veri.clans} />
      ) : (
        <p className="rounded bg-surface px-5 py-8 text-center text-sm text-fg-muted">
          Klanlar yüklenemedi.
        </p>
      )}
    </main>
  );
}
