import { getJson, getMe } from '@/lib/api';
import { sayi } from '@/lib/format';
import Link from 'next/link';

export const metadata = { title: 'Sıralama — Altai' };

/**
 * Oyuncu sıralaması — plan Faz 4 (istatistik/leaderboard).
 *
 * Ölçüt ve dönem BAĞLANTIYLA seçiliyor (query string), istemci durumuyla
 * değil: bir sıralamayı olduğu gibi paylaşabilmek gerekiyor ve "K/D, son
 * 30 gün" listesi bir bağlantı olarak anlam taşımalı.
 */

interface Satir {
  playerId: string;
  steamId: string | null;
  name: string | null;
  rounds: number;
  kills: number;
  deaths: number;
  revives: number;
  kdr: number;
}

const OLCUTLER = [
  { anahtar: 'kills', etiket: 'Öldürme' },
  { anahtar: 'kdr', etiket: 'K/D' },
  { anahtar: 'revives', etiket: 'Canlandırma' },
  { anahtar: 'rounds', etiket: 'Maç' },
] as const;

type Olcut = (typeof OLCUTLER)[number]['anahtar'];

const DONEMLER = [
  { anahtar: '', etiket: 'Tüm zamanlar' },
  { anahtar: '30', etiket: 'Son 30 gün' },
  { anahtar: '7', etiket: 'Son 7 gün' },
] as const;

function Sekme({
  etkin,
  href,
  children,
}: {
  etkin: boolean;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        etkin
          ? 'rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg'
          : 'rounded border border-border px-3 py-1.5 text-xs font-semibold text-fg-muted hover:text-fg'
      }
    >
      {children}
    </Link>
  );
}

export default async function SiralamaPage({
  searchParams,
}: {
  searchParams: Promise<{ metric?: string; days?: string }>;
}) {
  const me = await getMe();
  const { metric: metricHam, days: daysHam } = await searchParams;

  const metric: Olcut = OLCUTLER.some((o) => o.anahtar === metricHam)
    ? (metricHam as Olcut)
    : 'kills';
  const days = DONEMLER.some((d) => d.anahtar === (daysHam ?? '')) ? (daysHam ?? '') : '';

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

  const sorgu = new URLSearchParams({ metric, limit: '25' });
  if (days) sorgu.set('days', days);
  const satirlar = (await getJson<Satir[]>(`/stats/leaderboard?${sorgu}`)) ?? [];

  const bagl = (o: string, d: string) => `/siralama?metric=${o}${d ? `&days=${d}` : ''}`;

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-6">
      <header className="mb-5">
        <h1 className="display text-3xl">Sıralama</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Maç sonu skorbordlarından. K/D sıralamasında en az 10 maç oynamış oyuncular listeleniyor —
          tek maçlık bir oran, sıralamanın tepesini anlamsız kılardı.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap gap-2">
        {OLCUTLER.map((o) => (
          <Sekme key={o.anahtar} etkin={o.anahtar === metric} href={bagl(o.anahtar, days)}>
            {o.etiket}
          </Sekme>
        ))}
      </div>
      <div className="mb-5 flex flex-wrap gap-2">
        {DONEMLER.map((d) => (
          <Sekme
            key={d.anahtar || 'hepsi'}
            etkin={d.anahtar === days}
            href={bagl(metric, d.anahtar)}
          >
            {d.etiket}
          </Sekme>
        ))}
      </div>

      {satirlar.length === 0 ? (
        <p className="rounded border border-border bg-surface px-4 py-10 text-center text-sm text-fg-muted">
          Bu dönemde eşiği geçen oyuncu yok.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-border bg-surface">
          <table className="w-full min-w-[34rem] text-sm">
            <thead className="text-[11px] text-fg-faint">
              <tr className="border-border border-b">
                <th className="px-4 py-2 text-left font-medium">#</th>
                <th className="px-4 py-2 text-left font-medium">Oyuncu</th>
                <th className="px-4 py-2 text-right font-medium">Maç</th>
                <th className="px-4 py-2 text-right font-medium">Öldürme</th>
                <th className="px-4 py-2 text-right font-medium">Ölüm</th>
                <th className="px-4 py-2 text-right font-medium">K/D</th>
                <th className="px-4 py-2 text-right font-medium">Canlandırma</th>
              </tr>
            </thead>
            <tbody>
              {satirlar.map((s, i) => (
                <tr key={s.playerId} className="border-border border-b last:border-b-0">
                  <td className="num px-4 py-2 text-fg-faint">{i + 1}</td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/oyuncular/${s.playerId}`}
                      className="font-medium hover:text-accent"
                    >
                      {s.name ?? '(isim yok)'}
                    </Link>
                  </td>
                  <td className="num px-4 py-2 text-right">{sayi(s.rounds)}</td>
                  <td className="num px-4 py-2 text-right">{sayi(s.kills)}</td>
                  <td className="num px-4 py-2 text-right">{sayi(s.deaths)}</td>
                  <td className="num px-4 py-2 text-right">{s.kdr}</td>
                  <td className="num px-4 py-2 text-right">{sayi(s.revives)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
