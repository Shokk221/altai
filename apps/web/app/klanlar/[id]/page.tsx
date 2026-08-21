import { getJson, getMe } from '@/lib/api';
import { sayi } from '@/lib/format';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Klan — Altai' };

/**
 * Klan istatistiği ve kadro — plan Faz 5.
 *
 * Üyelik ZAMANA BAĞLI hesaplanıyor: dün transfer olan bir oyuncunun eski
 * klanındaki maçları buraya yazılmıyor. Sayfa bunu açıkça söylüyor, çünkü
 * "neden benim 300 maçım görünmüyor" sorusunun cevabı görünür olmalı.
 */

interface Stat {
  clanId: string;
  uyeSayisi: number;
  aktifUye: number;
  maclar: number;
  kills: number;
  deaths: number;
  revives: number;
  teamkills: number;
  kdr: number;
  wins: number;
  losses: number;
  winRate: number | null;
}

interface Uye {
  playerId: string;
  steamId: string | null;
  name: string | null;
  maclar: number;
  kills: number;
  deaths: number;
  revives: number;
  kdr: number;
}

interface Cevap {
  clan: { id: string; name: string };
  days: number | null;
  stat: Stat;
  uyeler: Uye[];
}

const DONEMLER = [
  { anahtar: '', etiket: 'Tüm zamanlar' },
  { anahtar: '30', etiket: 'Son 30 gün' },
  { anahtar: '7', etiket: 'Son 7 gün' },
] as const;

function Deger({ baslik, deger }: { baslik: string; deger: string }) {
  return (
    <div>
      <div className="display text-lg leading-tight">{deger}</div>
      <div className="text-[11px] text-fg-faint">{baslik}</div>
    </div>
  );
}

export default async function KlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { id } = await params;
  const { days: daysHam } = await searchParams;
  const days = DONEMLER.some((d) => d.anahtar === (daysHam ?? '')) ? (daysHam ?? '') : '';
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

  const veri = await getJson<Cevap>(`/clans/${id}/stats${days ? `?days=${days}` : ''}`);
  if (veri === undefined) notFound();
  if (!veri) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
        <h1 className="display text-2xl">Klan yüklenemedi</h1>
      </main>
    );
  }

  const { clan, stat, uyeler } = veri;

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-6">
      <Link href="/klanlar" className="text-xs font-semibold text-fg-muted hover:text-fg">
        ← Klanlar
      </Link>

      <header className="mt-2 mb-5">
        <h1 className="display text-3xl">{clan.name}</h1>
        <p className="mt-1 text-sm text-fg-muted">
          İstatistikler üyelik dönemine göre hesaplanıyor: bir oyuncunun başka klandayken oynadığı
          maçlar buraya sayılmıyor.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap gap-2">
        {DONEMLER.map((d) => (
          <Link
            key={d.anahtar || 'hepsi'}
            href={`/klanlar/${id}${d.anahtar ? `?days=${d.anahtar}` : ''}`}
            className={
              d.anahtar === days
                ? 'rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg'
                : 'rounded border border-border px-3 py-1.5 text-xs font-semibold text-fg-muted hover:text-fg'
            }
          >
            {d.etiket}
          </Link>
        ))}
      </div>

      <section className="mb-7 rounded border border-border bg-surface px-5 py-4">
        <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
          <Deger baslik="kadro" deger={sayi(stat.uyeSayisi)} />
          <Deger baslik="dönemde oynayan" deger={sayi(stat.aktifUye)} />
          <Deger baslik="maç" deger={sayi(stat.maclar)} />
          <Deger baslik="öldürme" deger={sayi(stat.kills)} />
          <Deger baslik="ölüm" deger={sayi(stat.deaths)} />
          <Deger baslik="K / D" deger={String(stat.kdr)} />
          <Deger baslik="canlandırma" deger={sayi(stat.revives)} />
          {stat.winRate === null ? null : <Deger baslik="galibiyet" deger={`%${stat.winRate}`} />}
          {stat.teamkills > 0 ? <Deger baslik="TK" deger={sayi(stat.teamkills)} /> : null}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">
          Kadro <span className="text-fg-faint">({uyeler.length})</span>
        </h2>
        {uyeler.length === 0 ? (
          <p className="rounded border border-border bg-surface px-4 py-8 text-center text-sm text-fg-muted">
            Bu klanın aktif üyesi yok.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-border bg-surface">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="text-[11px] text-fg-faint">
                <tr className="border-border border-b">
                  <th className="px-4 py-2 text-left font-medium">Oyuncu</th>
                  <th className="px-4 py-2 text-right font-medium">Maç</th>
                  <th className="px-4 py-2 text-right font-medium">Öldürme</th>
                  <th className="px-4 py-2 text-right font-medium">Ölüm</th>
                  <th className="px-4 py-2 text-right font-medium">K/D</th>
                  <th className="px-4 py-2 text-right font-medium">Canlandırma</th>
                </tr>
              </thead>
              <tbody>
                {uyeler.map((u) => (
                  <tr key={u.playerId} className="border-border border-b last:border-b-0">
                    <td className="px-4 py-2">
                      <Link
                        href={`/oyuncular/${u.playerId}`}
                        className="font-medium hover:text-accent"
                      >
                        {u.name ?? '(isim yok)'}
                      </Link>
                    </td>
                    <td className="num px-4 py-2 text-right">{sayi(u.maclar)}</td>
                    <td className="num px-4 py-2 text-right">{sayi(u.kills)}</td>
                    <td className="num px-4 py-2 text-right">{sayi(u.deaths)}</td>
                    <td className="num px-4 py-2 text-right">{u.kdr}</td>
                    <td className="num px-4 py-2 text-right">{sayi(u.revives)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
