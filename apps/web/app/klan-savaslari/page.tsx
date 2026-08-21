import { getJson, getMe } from '@/lib/api';
import { tarihSaat } from '@/lib/format';
import Link from 'next/link';

export const metadata = { title: 'Klan savaşları — Altai' };

/**
 * Klan savaşları listesi — plan Faz 5.
 *
 * Eski `clanwarenforcer` izinli oyuncu listesini plugin config'inde
 * tutuyordu; her maç öncesi dosya düzenleyip agent'ı yeniden başlatmak
 * gerekiyordu. Buradan yönetilen liste plugin'e sorguyla gidiyor.
 */

interface Savas {
  id: string;
  name: string;
  status: string;
  scheduledAt: string | null;
  lockedAt: string | null;
}

const DURUM_ETIKET: Record<string, string> = {
  planned: 'planlandı',
  lobby: 'lobi',
  live: 'CANLI',
  finished: 'bitti',
  cancelled: 'iptal',
};

export default async function KlanSavaslariPage() {
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

  const veri = await getJson<{ wars: Savas[] }>('/clan-wars');
  if (veri === undefined) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
        <h1 className="display text-2xl">Yetkin yok</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Klan savaşlarını yönetmek için <code>clan.manage</code> izni gerekiyor.
        </p>
      </main>
    );
  }

  const savaslar = veri?.wars ?? [];

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-6">
      <header className="mb-5">
        <h1 className="display text-3xl">Klan savaşları</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Savaş <strong>canlı</strong> duruma alındığında sunucu kadroya kapanır: listede olmayan
          oyuncular uyarılıp çıkarılır. Lobi aşamasında kimse atılmaz.
        </p>
      </header>

      {savaslar.length === 0 ? (
        <p className="rounded border border-border bg-surface px-4 py-10 text-center text-sm text-fg-muted">
          Henüz klan savaşı yok.
        </p>
      ) : (
        <ul className="space-y-2">
          {savaslar.map((s) => (
            <li key={s.id} className="rounded border border-border bg-surface p-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link href={`/klan-savaslari/${s.id}`} className="font-semibold hover:text-accent">
                  {s.name}
                </Link>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    s.status === 'live'
                      ? 'bg-danger text-danger-fg'
                      : 'bg-accent-weak text-accent-2'
                  }`}
                >
                  {DURUM_ETIKET[s.status] ?? s.status}
                </span>
                {s.lockedAt ? (
                  <span className="text-[11px] text-fg-faint">kadro kilitli</span>
                ) : null}
                <span className="ml-auto text-[11px] text-fg-faint">
                  {s.scheduledAt ? tarihSaat(s.scheduledAt) : 'tarih yok'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
