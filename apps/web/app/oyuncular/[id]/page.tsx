import { BanKaldir, EtiketKaldir, HizliEylemler, KaydiKapat } from '@/components/player-actions';
import { Badge } from '@/components/ui/badge';
import { getJson, getMe, publicApiUrl } from '@/lib/api';
import { banBitis, sayi, sure, tarih, tarihSaat } from '@/lib/format';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

export const metadata = { title: 'Oyuncu — Altai' };

/**
 * Oyuncu profili.
 *
 * DÜZEN KARARI: sayfa tek ekrana sığmalı. İlk sürüm tam genişlikte kartları
 * alt alta diziyordu ve her listenin tamamını basıyordu — bir oyuncuya
 * bakmak için sonuna kadar kaydırmak gerekiyordu, ekranın genişliği ise hiç
 * kullanılmıyordu. Moderasyonda karar hızlı verilir.
 *
 * Şimdiki yapı: üstte tek bantta künye + istatistik + eylemler, altta yan
 * yana üç panel. Listeler SAYFAYI değil kendi içlerini kaydırıyor; böylece
 * sayfanın boyu oyuncunun ban sayısına göre değişmiyor.
 */

interface Ban {
  id: string;
  reason: string;
  internalNote: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  issuedByName: string | null;
  createdAt: string;
  source: string;
  active: boolean;
}

interface Flag {
  id: string;
  flagId: string;
  name: string;
  color: string | null;
  addedAt: string;
  removedAt: string | null;
}

interface Kayit {
  id: string;
  kind: 'note' | 'warning' | 'watchlist';
  body: string;
  authorName: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

interface Profil {
  player: {
    id: string;
    steamId: string | null;
    eosId: string | null;
    battlemetricsId: string | null;
    name: string;
  };
  names: { name: string; firstSeen: string | null; lastSeen: string | null }[];
  bans: Ban[];
  flags: Flag[];
  records: Kayit[];
  oyun: {
    oturum: number;
    toplamSaniye: number;
    ilkGorulme: string | null;
    sonGorulme: string | null;
    mac: number;
    kill: number;
    olum: number;
    revive: number;
  };
}

const KAYIT_ETIKET = { note: 'Not', warning: 'Uyarı', watchlist: 'Takip' } as const;

/** Künye bandındaki tek istatistik. Etiket küçük, değer dolgun. */
function Deger({ baslik, deger }: { baslik: string; deger: string }) {
  return (
    <div>
      <div className="display text-lg leading-tight">{deger}</div>
      <div className="text-[11px] text-fg-muted">{baslik}</div>
    </div>
  );
}

/**
 * Sabit yükseklikte panel: içerik uzunsa panel kendi içinde kayar, sayfa
 * uzamaz.
 */
function Panel({
  baslik,
  sayac,
  children,
}: {
  baslik: string;
  sayac: number;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-0 flex-col rounded bg-surface">
      <header className="flex shrink-0 items-baseline justify-between gap-2 px-4 pt-3.5 pb-2">
        <h2 className="text-sm font-semibold">{baslik}</h2>
        <span className="text-xs tabular-nums text-fg-muted">{sayac}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
    </section>
  );
}

function Bos({ metin }: { metin: string }) {
  return <p className="py-6 text-center text-xs text-fg-muted">{metin}</p>;
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  const profil = await getJson<Profil>(`/players/${id}`);

  if (!me) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
        <h1 className="display text-2xl">Giriş gerekli</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Oyuncu profillerini görmek için panele giriş yapın.
        </p>
        <Link href="/" className="mt-5 inline-block text-sm font-semibold text-accent">
          Girişe dön
        </Link>
      </main>
    );
  }
  if (profil === undefined) notFound();
  if (!profil) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
        <h1 className="display text-2xl">Profil yüklenemedi</h1>
        <p className="mt-2 text-sm text-fg-muted">Yetkiniz olmayabilir ya da api yanıt vermiyor.</p>
      </main>
    );
  }

  const apiUrl = publicApiUrl();
  const yetki = (p: string) => me.permissions.includes(p) || me.systemRole === 'super_admin';
  const banlayabilir = yetki('player.ban');
  const notYazabilir = yetki('player.note.write');
  const etiketYonetir = yetki('flag.manage');

  const { player, oyun } = profil;
  const aktifBan = profil.bans.find((b) => b.active);
  const aktifEtiketler = profil.flags.filter((f) => !f.removedAt);
  const kd = oyun.olum > 0 ? (oyun.kill / oyun.olum).toFixed(2) : String(oyun.kill);
  const acikKayit = profil.records.filter((k) => !k.resolvedAt).length;

  return (
    // h-screen + min-h-0 zinciri: paneller taşmak yerine kendi içlerinde
    // kaysın diye yükseklik yukarıdan aşağı aktarılıyor.
    <main className="mx-auto flex h-screen w-full max-w-6xl flex-col gap-3 px-4 py-4">
      <Link
        href="/oyuncular"
        className="shrink-0 text-xs font-semibold text-fg-muted hover:text-fg"
      >
        ← Oyuncular
      </Link>

      {/* künye: kimlik, durum, istatistik ve eylem tek blokta */}
      <header className="shrink-0 rounded bg-surface px-5 py-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="display text-2xl sm:text-3xl">{player.name}</h1>
          {aktifBan ? <Badge tone="danger">Banlı</Badge> : null}
          {aktifEtiketler.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1">
              <Badge tone="info">{f.name}</Badge>
              {etiketYonetir ? <EtiketKaldir apiUrl={apiUrl} atamaId={f.id} /> : null}
            </span>
          ))}
          <span className="ml-auto font-mono text-[11px] text-fg-muted">
            {player.steamId ?? 'Steam yok'} · {player.eosId ?? 'EOS yok'}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-x-7 gap-y-3">
          <Deger baslik="oynama süresi" deger={sure(oyun.toplamSaniye)} />
          <Deger baslik="oturum" deger={sayi(oyun.oturum)} />
          <Deger baslik="maç" deger={sayi(oyun.mac)} />
          <Deger baslik="K / D" deger={kd} />
          <Deger baslik="ban" deger={sayi(profil.bans.length)} />
          <Deger baslik="açık kayıt" deger={sayi(acikKayit)} />
          <div className="ml-auto text-right text-[11px] leading-relaxed text-fg-muted">
            <div>ilk görülme {tarih(oyun.ilkGorulme)}</div>
            <div>son görülme {tarih(oyun.sonGorulme)}</div>
          </div>
        </div>

        {banlayabilir || notYazabilir ? (
          <div className="mt-4">
            <HizliEylemler
              apiUrl={apiUrl}
              playerId={player.id}
              banlayabilir={banlayabilir}
              notYazabilir={notYazabilir}
            />
          </div>
        ) : null}
      </header>

      {/* çalışma alanı: yan yana paneller, her biri kendi içinde kayar */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel baslik="Banlar" sayac={profil.bans.length}>
          {profil.bans.length === 0 ? (
            <Bos metin="Ban kaydı yok" />
          ) : (
            <ul className="flex flex-col gap-2">
              {profil.bans.map((b) => (
                <li key={b.id} className="rounded-sm bg-surface-2 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    {b.active ? (
                      <Badge tone="danger">aktif</Badge>
                    ) : b.revokedAt ? (
                      <Badge tone="neutral">kaldırıldı</Badge>
                    ) : (
                      <Badge tone="neutral">doldu</Badge>
                    )}
                    <span className="text-[11px] text-fg-muted">
                      {tarih(b.createdAt)} → {banBitis(b.expiresAt)}
                    </span>
                  </div>
                  <p className="mt-1.5 text-[13px] leading-snug">{b.reason}</p>
                  <p className="mt-1 text-[11px] text-fg-muted">
                    {b.issuedByName ?? 'bilinmiyor'}
                    {b.source !== 'altai' ? ` · ${b.source}` : ''}
                  </p>
                  {b.active && banlayabilir ? (
                    <div className="mt-2">
                      <BanKaldir apiUrl={apiUrl} banId={b.id} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel baslik="Kayıtlar" sayac={profil.records.length}>
          {profil.records.length === 0 ? (
            <Bos metin="Not, uyarı ya da takip yok" />
          ) : (
            <ul className="flex flex-col gap-2">
              {profil.records.map((k) => (
                <li key={k.id} className="rounded-sm bg-surface-2 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge tone={k.kind === 'warning' ? 'accent' : 'neutral'}>
                        {KAYIT_ETIKET[k.kind]}
                      </Badge>
                      <span className="text-[11px] text-fg-muted">{tarihSaat(k.createdAt)}</span>
                    </div>
                    {!k.resolvedAt && notYazabilir ? (
                      <KaydiKapat apiUrl={apiUrl} recordId={k.id} />
                    ) : null}
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-snug">{k.body}</p>
                  <p className="mt-1 text-[11px] text-fg-muted">
                    {k.authorName ?? 'bilinmiyor'}
                    {k.resolvedAt ? ' · kapatıldı' : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel baslik="İsim geçmişi" sayac={profil.names.length}>
          {profil.names.length === 0 ? (
            <Bos metin="İsim kaydı yok" />
          ) : (
            <ul className="flex flex-col">
              {profil.names.map((n) => (
                <li
                  key={n.name}
                  className="flex items-baseline justify-between gap-3 py-1.5 text-[13px]"
                >
                  <span className="truncate">{n.name}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-fg-muted">
                    {tarih(n.lastSeen)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </main>
  );
}
