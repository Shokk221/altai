import { ActivityLog, type Sayfa } from '@/components/activity-log';
import { getJson, getMe, publicApiUrl } from '@/lib/api';
import Link from 'next/link';

export const metadata = { title: 'Kayıtlar — Altai' };

/**
 * Sistem günlüğü sayfası.
 *
 * İlk sayfa sunucuda çekiliyor: ekran açılır açılmaz dolu geliyor, sonraki
 * sayfalar ve filtreler istemciden.
 */
export default async function KayitlarPage() {
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

  const yetkili = me.permissions.includes('audit.read') || me.systemRole === 'super_admin';
  if (!yetkili) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
        <h1 className="display text-2xl">Yetkiniz yok</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Sistem günlüğünü görmek için <code>audit.read</code> izni gerekiyor.
        </p>
        <Link href="/" className="mt-5 inline-block text-sm font-semibold text-accent">
          Panele dön
        </Link>
      </main>
    );
  }

  const [sayfa, aktorVerisi, ozet] = await Promise.all([
    getJson<Sayfa>('/activity'),
    getJson<{ aktorler: { id: string; ad: string; adet: number }[] }>('/activity/aktorler'),
    getJson<{ son24Saat: { kategori: string; adet: number }[] }>('/activity/ozet'),
  ]);

  const sayac = new Map((ozet?.son24Saat ?? []).map((s) => [s.kategori, s.adet]));
  const toplam = [...sayac.values()].reduce((a, b) => a + b, 0);

  return (
    <main className="mx-auto w-full max-w-[80rem] px-5 py-8">
      <header className="mb-6">
        <h1 className="display text-3xl">Kayıtlar</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Panelde ve sunucuda olan her şey. Kim giriş yaptı, kim kime baktı, kim ban attı, agent ne
          zaman koptu — hepsi burada.
        </p>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        <Sayac ad="Son 24 saat" deger={toplam} vurgu />
        <Sayac ad="Moderasyon" deger={sayac.get('moderasyon') ?? 0} />
        <Sayac ad="Yetki" deger={sayac.get('erisim') ?? 0} />
        <Sayac ad="Oturum" deger={sayac.get('oturum') ?? 0} />
        <Sayac ad="Okuma" deger={sayac.get('okuma') ?? 0} />
        <Sayac ad="Sistem" deger={sayac.get('sistem') ?? 0} />
      </div>

      {sayfa ? (
        <ActivityLog
          apiUrl={publicApiUrl()}
          ilkSayfa={sayfa}
          aktorler={aktorVerisi?.aktorler ?? []}
        />
      ) : (
        <p className="rounded-lg bg-surface px-5 py-10 text-center text-sm text-fg-muted">
          Günlük okunamadı.
        </p>
      )}
    </main>
  );
}

function Sayac({ ad, deger, vurgu }: { ad: string; deger: number; vurgu?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3.5 py-3">
      <p className="text-[11px] uppercase tracking-wide text-fg-faint">{ad}</p>
      <p className={`num mt-0.5 text-xl ${vurgu ? 'text-accent' : 'text-fg'}`}>
        {deger.toLocaleString('tr-TR')}
      </p>
    </div>
  );
}
