import { TalepKapat } from '@/components/talep-kapat';
import { getJson, getMe, publicApiUrl } from '@/lib/api';
import { tarihSaat } from '@/lib/format';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Talep — Altai' };

/**
 * Tek talebin transkripti — plan Faz 5.
 *
 * Transkript CANLI yazıldığı için burada gördüğün konuşma, thread hâlâ
 * açıkken bile güncel. Eski sistem yalnızca kapanışta dışa aktarıyordu ve
 * açık bir talebe panelden bakmak mümkün değildi.
 */

interface Talep {
  id: string;
  number: number;
  subject: string;
  category: string | null;
  status: string;
  openedByDiscordId: string;
  openedByPlayerId: string | null;
  discordThreadId: string | null;
  claimedByDiscordId: string | null;
  closeReason: string | null;
  createdAt: string;
  closedAt: string | null;
}

interface Mesaj {
  id: string;
  authorDiscordId: string;
  authorName: string | null;
  body: string;
  attachments: string[] | null;
  sentAt: string;
}

export default async function TalepPage({ params }: { params: Promise<{ id: string }> }) {
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

  const veri = await getJson<{ ticket: Talep; mesajlar: Mesaj[] }>(`/tickets/${id}`);
  if (veri === undefined) notFound();
  if (!veri) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
        <h1 className="display text-2xl">Talep yüklenemedi</h1>
      </main>
    );
  }

  const { ticket, mesajlar } = veri;
  const kapali = ticket.status === 'closed';

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-6">
      <Link href="/talepler" className="text-xs font-semibold text-fg-muted hover:text-fg">
        ← Talepler
      </Link>

      <header className="mt-2 mb-5 rounded border border-border bg-surface px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="display text-2xl">
            #{ticket.number} · {ticket.subject}
          </h1>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
              kapali ? 'bg-surface-2 text-fg-faint' : 'bg-accent-weak text-accent-2'
            }`}
          >
            {kapali ? 'kapalı' : ticket.status === 'claimed' ? 'üstlenildi' : 'açık'}
          </span>
        </div>

        <div className="mt-2 space-y-0.5 text-xs text-fg-muted">
          <div>
            Açan: <span className="font-mono">{ticket.openedByDiscordId}</span>
            {ticket.openedByPlayerId ? (
              <>
                {' · '}
                <Link
                  href={`/oyuncular/${ticket.openedByPlayerId}`}
                  className="font-semibold text-accent hover:underline"
                >
                  oyuncu profili
                </Link>
              </>
            ) : (
              // Bağ yoksa söyleniyor: yetkilinin "bu kim" sorusuna
              // cevabı yok ve bunu bilmesi gerekiyor.
              <span className="text-fg-faint"> · Discord bağı yok</span>
            )}
          </div>
          {ticket.claimedByDiscordId ? (
            <div>
              Üstlenen: <span className="font-mono">{ticket.claimedByDiscordId}</span>
            </div>
          ) : null}
          <div>Açılış: {tarihSaat(ticket.createdAt)}</div>
          {ticket.closedAt ? (
            <div>
              Kapanış: {tarihSaat(ticket.closedAt)}
              {ticket.closeReason ? ` — ${ticket.closeReason}` : ''}
            </div>
          ) : null}
        </div>

        {kapali ? null : <TalepKapat apiUrl={publicApiUrl()} talepId={ticket.id} />}
      </header>

      <section>
        <h2 className="mb-2 text-sm font-semibold">
          Transkript <span className="text-fg-faint">({mesajlar.length} mesaj)</span>
        </h2>

        {mesajlar.length === 0 ? (
          <p className="rounded border border-border bg-surface px-4 py-8 text-center text-sm text-fg-muted">
            Henüz mesaj yok. Bot kapalıysa ya da Discord'da MESSAGE CONTENT izni açık değilse
            transkript boş kalır.
          </p>
        ) : (
          <ol className="space-y-2">
            {mesajlar.map((m) => (
              <li key={m.id} className="rounded border border-border bg-surface px-4 py-2.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-semibold">{m.authorName ?? m.authorDiscordId}</span>
                  <span className="text-[11px] text-fg-faint">{tarihSaat(m.sentAt)}</span>
                </div>
                {m.body ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
                ) : (
                  // Boş gövde genelde MESSAGE CONTENT izninin kapalı
                  // olduğunu gösteriyor; sessizce boş satır basmak bunu
                  // gizlerdi.
                  <p className="mt-1 text-xs text-fg-faint italic">(içerik kaydedilmemiş)</p>
                )}
                {m.attachments && m.attachments.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {m.attachments.map((url) => (
                      <li key={url}>
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-accent hover:underline"
                        >
                          ek dosya
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
