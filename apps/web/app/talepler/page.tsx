import { getJson, getMe } from '@/lib/api';
import { tarihSaat } from '@/lib/format';
import Link from 'next/link';

export const metadata = { title: 'Talepler — Altai' };

/**
 * Destek talepleri — web aynası (plan Faz 5).
 *
 * Konuşma Discord'da geçiyor; burası onun aynası. Panelden cevap
 * YAZILMIYOR (bkz. routes/tickets.ts) — tek yönlü ayna, gönderilmediği
 * hâlde gönderilmiş sayılan bir mesajdan iyidir.
 */

export interface Talep {
  id: string;
  number: number;
  subject: string;
  category: string | null;
  status: string;
  openedByDiscordId: string;
  openedByPlayerId: string | null;
  discordThreadId: string | null;
  claimedByDiscordId: string | null;
  createdAt: string;
  closedAt: string | null;
  mesajSayisi: number;
}

const DURUMLAR = [
  { anahtar: '', etiket: 'Hepsi' },
  { anahtar: 'open', etiket: 'Açık' },
  { anahtar: 'claimed', etiket: 'Üstlenilmiş' },
  { anahtar: 'closed', etiket: 'Kapalı' },
] as const;

const DURUM_ETIKET: Record<string, string> = {
  open: 'açık',
  claimed: 'üstlenildi',
  closed: 'kapalı',
};

export default async function TaleplerPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const me = await getMe();
  const { status: durumHam } = await searchParams;
  const durum = DURUMLAR.some((d) => d.anahtar === (durumHam ?? '')) ? (durumHam ?? '') : '';

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

  const veri = await getJson<{ tickets: Talep[] }>(`/tickets${durum ? `?status=${durum}` : ''}`);

  // `undefined` = yetki yok. Boş listeyle karıştırmamak gerekiyor:
  // "talep yok" demek, göremediği bir veri için yanlış bilgi olurdu.
  if (veri === undefined) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
        <h1 className="display text-2xl">Yetkin yok</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Talepleri görmek için <code>ticket.manage</code> izni gerekiyor.
        </p>
      </main>
    );
  }

  const talepler = veri?.tickets ?? [];

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-6">
      <header className="mb-5">
        <h1 className="display text-3xl">Talepler</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Konuşma Discord thread'inde geçiyor; burası aynası. Transkript canlı yazılıyor, kapanışta
          değil — bot kapalıyken bile kayıt kaybolmasın diye.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap gap-2">
        {DURUMLAR.map((d) => (
          <Link
            key={d.anahtar || 'hepsi'}
            href={`/talepler${d.anahtar ? `?status=${d.anahtar}` : ''}`}
            className={
              d.anahtar === durum
                ? 'rounded bg-accent px-3 py-1.5 text-xs font-semibold text-accent-fg'
                : 'rounded border border-border px-3 py-1.5 text-xs font-semibold text-fg-muted hover:text-fg'
            }
          >
            {d.etiket}
          </Link>
        ))}
      </div>

      {talepler.length === 0 ? (
        <p className="rounded border border-border bg-surface px-4 py-10 text-center text-sm text-fg-muted">
          Bu süzgeçte talep yok.
        </p>
      ) : (
        <ul className="space-y-2">
          {talepler.map((t) => (
            <li key={t.id} className="rounded border border-border bg-surface p-3">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <Link href={`/talepler/${t.id}`} className="font-semibold hover:text-accent">
                  #{t.number} · {t.subject}
                </Link>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    t.status === 'closed'
                      ? 'bg-surface-2 text-fg-faint'
                      : 'bg-accent-weak text-accent-2'
                  }`}
                >
                  {DURUM_ETIKET[t.status] ?? t.status}
                </span>
                {t.category ? (
                  <span className="text-[11px] text-fg-muted">{t.category}</span>
                ) : null}
                <span className="ml-auto text-[11px] text-fg-faint">
                  {t.mesajSayisi} mesaj · {tarihSaat(t.createdAt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
