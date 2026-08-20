import { getJson, getMe } from '@/lib/api';
import { sure, tarihSaat } from '@/lib/format';
import Link from 'next/link';

export const metadata = { title: 'Yetkili kamerası — Altai' };

/**
 * Yetkili kamerası kullanımı — plan Faz 6.
 *
 * Kamera, başkasının ekranını izleme yetkisi. Kullanımının denetlenebilir
 * olması gerekiyor ve bu sayfa o denetimin yeri.
 *
 * İKİ GÖRÜNÜM birlikte: üstte yetkili başına toplam ("kim ne kadar"),
 * altta tek tek oturumlar ("ne zaman"). Yalnızca oturum listesi verseydik
 * toplamı elle çıkarmak gerekirdi; yalnızca özet verseydik "dün gece 3
 * saat kamerada kalmış" gibi bir örüntü görünmezdi.
 */

interface Oturum {
  id: string;
  playerId: string;
  name: string | null;
  steamId: string | null;
  serverSlug: string | null;
  enteredAt: string;
  leftAt: string | null;
  saniye: number;
  acik: boolean;
}

interface Yetkili {
  playerId: string;
  steamId: string | null;
  name: string | null;
  oturum: number;
  toplamSaniye: number;
  sonGiris: string | null;
  acik: number;
}

const DONEMLER = [
  { anahtar: '7', etiket: 'Son 7 gün' },
  { anahtar: '30', etiket: 'Son 30 gün' },
  { anahtar: '90', etiket: 'Son 90 gün' },
] as const;

function Sekme({ etkin, href, children }: { etkin: boolean; href: string; children: string }) {
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

export default async function KameraPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const me = await getMe();
  const { days: daysHam } = await searchParams;
  const days = DONEMLER.some((d) => d.anahtar === daysHam) ? (daysHam as string) : '30';

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

  const [ozet, liste] = await Promise.all([
    getJson<{ yetkililer: Yetkili[] }>(`/admin-cam/ozet?days=${days}`),
    getJson<{ oturumlar: Oturum[] }>(`/admin-cam?days=${days}&limit=100`),
  ]);

  // `undefined` = yetki yok (uç 403 döndü). Boş liste ile karıştırmamak
  // gerekiyor: birine "kayıt yok" demek, aslında göremediği bir veri için
  // yanlış bilgi olurdu.
  if (ozet === undefined || liste === undefined) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
        <h1 className="display text-2xl">Yetkin yok</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Kamera kayıtlarını görmek için denetim kaydı okuma yetkisi gerekiyor.
        </p>
      </main>
    );
  }

  const yetkililer = ozet?.yetkililer ?? [];
  const oturumlar = liste?.oturumlar ?? [];

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-6">
      <header className="mb-5">
        <h1 className="display text-3xl">Yetkili kamerası</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Kamera başkasının ekranını izleme yetkisi; kullanımı burada görünür. Süren oturumlar şu
          ana kadar sayılır.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap gap-2">
        {DONEMLER.map((d) => (
          <Sekme key={d.anahtar} etkin={d.anahtar === days} href={`/kamera?days=${d.anahtar}`}>
            {d.etiket}
          </Sekme>
        ))}
      </div>

      <section className="mb-7">
        <h2 className="mb-2 text-sm font-semibold">Yetkili başına</h2>
        {yetkililer.length === 0 ? (
          <p className="rounded border border-border bg-surface px-4 py-8 text-center text-sm text-fg-muted">
            Bu dönemde kamera kaydı yok.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-border bg-surface">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="text-[11px] text-fg-faint">
                <tr className="border-border border-b">
                  <th className="px-4 py-2 text-left font-medium">Yetkili</th>
                  <th className="px-4 py-2 text-right font-medium">Oturum</th>
                  <th className="px-4 py-2 text-right font-medium">Toplam süre</th>
                  <th className="px-4 py-2 text-right font-medium">Son giriş</th>
                </tr>
              </thead>
              <tbody>
                {yetkililer.map((y) => (
                  <tr key={y.playerId} className="border-border border-b last:border-b-0">
                    <td className="px-4 py-2">
                      <Link
                        href={`/oyuncular/${y.playerId}`}
                        className="font-medium hover:text-accent"
                      >
                        {y.name ?? '(isim yok)'}
                      </Link>
                      {y.acik > 0 ? (
                        <span className="ml-2 rounded bg-accent-weak px-1.5 py-0.5 text-[10px] font-semibold text-accent-2">
                          kamerada
                        </span>
                      ) : null}
                    </td>
                    <td className="num px-4 py-2 text-right">{y.oturum}</td>
                    <td className="num px-4 py-2 text-right">{sure(y.toplamSaniye)}</td>
                    <td className="px-4 py-2 text-right text-xs text-fg-muted">
                      {tarihSaat(y.sonGiris)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Oturumlar</h2>
        {oturumlar.length === 0 ? (
          <p className="rounded border border-border bg-surface px-4 py-8 text-center text-sm text-fg-muted">
            Bu dönemde kamera oturumu yok.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-border bg-surface">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-[11px] text-fg-faint">
                <tr className="border-border border-b">
                  <th className="px-4 py-2 text-left font-medium">Yetkili</th>
                  <th className="px-4 py-2 text-left font-medium">Sunucu</th>
                  <th className="px-4 py-2 text-left font-medium">Giriş</th>
                  <th className="px-4 py-2 text-right font-medium">Süre</th>
                </tr>
              </thead>
              <tbody>
                {oturumlar.map((o) => (
                  <tr key={o.id} className="border-border border-b last:border-b-0">
                    <td className="px-4 py-2">
                      <Link
                        href={`/oyuncular/${o.playerId}`}
                        className="font-medium hover:text-accent"
                      >
                        {o.name ?? '(isim yok)'}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-xs text-fg-muted">{o.serverSlug ?? '—'}</td>
                    <td className="px-4 py-2 text-xs text-fg-muted">{tarihSaat(o.enteredAt)}</td>
                    <td className="num px-4 py-2 text-right">
                      {sure(o.saniye)}
                      {o.acik ? (
                        <span className="ml-1 text-[10px] text-accent-2">sürüyor</span>
                      ) : null}
                    </td>
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
