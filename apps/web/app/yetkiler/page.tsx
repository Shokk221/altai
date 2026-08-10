import { RoleMappings, type Veri } from '@/components/role-mappings';
import { getJson, getMe, publicApiUrl } from '@/lib/api';
import Link from 'next/link';

export const metadata = { title: 'Yetkiler — Altai' };

export default async function YetkilerPage() {
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

  const yetkili = me.permissions.includes('admin_list.manage') || me.systemRole === 'super_admin';
  if (!yetkili) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
        <h1 className="display text-2xl">Yetkiniz yok</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Rol eşlemelerini yönetmek için <code>admin_list.manage</code> izni gerekiyor.
        </p>
        <Link href="/oyuncular" className="mt-5 inline-block text-sm font-semibold text-accent">
          Oyunculara dön
        </Link>
      </main>
    );
  }

  const veri = await getJson<Veri>('/role-mappings');

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-8">
      <Link href="/oyuncular" className="text-xs font-semibold text-fg-muted hover:text-fg">
        ← Oyuncular
      </Link>
      <header className="mt-4 mb-6">
        <h1 className="display text-3xl">Yetkiler</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Discord rolü → panel izinleri ve oyun içi grup. Zincirin başlangıcı burası: bir rol buraya
          eşlenmemişse o rolü taşıyan kişi panele girer ama hiçbir şey yapamaz.
        </p>
      </header>

      {veri ? (
        <RoleMappings apiUrl={publicApiUrl()} veri={veri} />
      ) : (
        <p className="rounded bg-surface px-5 py-8 text-center text-sm text-fg-muted">
          Eşlemeler yüklenemedi.
        </p>
      )}
    </main>
  );
}
