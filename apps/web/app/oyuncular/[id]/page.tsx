import {
  BanFormu,
  BanKaldir,
  EtiketKaldir,
  KaydiKapat,
  KayitFormu,
} from '@/components/player-actions';
import { Badge } from '@/components/ui/badge';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty';
import { getJson, getMe, publicApiUrl } from '@/lib/api';
import { banBitis, sayi, sure, tarih, tarihSaat } from '@/lib/format';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Oyuncu — Altai' };

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

function Istatistik({ baslik, deger }: { baslik: string; deger: string }) {
  return (
    <div className="rounded bg-surface px-4 py-3">
      <div className="display text-xl">{deger}</div>
      <div className="text-xs text-fg-muted">{baslik}</div>
    </div>
  );
}

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  const profil = await getJson<Profil>(`/players/${id}`);

  // Oturum yok ile oyuncu yok farklı durumlar: birine giriş, diğerine 404.
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

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <Link href="/oyuncular" className="text-sm font-semibold text-fg-muted hover:text-fg">
        ← Oyuncular
      </Link>

      <header className="mt-4 mb-7">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="display text-3xl sm:text-4xl">{player.name}</h1>
          {aktifBan ? <Badge tone="danger">Banlı</Badge> : null}
          {aktifEtiketler.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1.5">
              <Badge tone="info">{f.name}</Badge>
              {etiketYonetir ? <EtiketKaldir apiUrl={apiUrl} atamaId={f.id} /> : null}
            </span>
          ))}
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-fg-muted">
          {player.steamId ? (
            <div>
              <dt className="inline">Steam </dt>
              <dd className="inline text-fg">{player.steamId}</dd>
            </div>
          ) : null}
          {player.eosId ? (
            <div>
              <dt className="inline">EOS </dt>
              <dd className="inline text-fg">{player.eosId}</dd>
            </div>
          ) : null}
        </dl>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Istatistik baslik="oynama süresi" deger={sure(oyun.toplamSaniye)} />
        <Istatistik baslik="oturum" deger={sayi(oyun.oturum)} />
        <Istatistik baslik="maç" deger={sayi(oyun.mac)} />
        <Istatistik baslik="K / D" deger={kd} />
      </section>

      <p className="mb-8 text-xs text-fg-muted">
        İlk görülme {tarih(oyun.ilkGorulme)} · Son görülme {tarih(oyun.sonGorulme)}
        {oyun.mac > 0 ? ` · ${sayi(oyun.kill)} öldürme, ${sayi(oyun.revive)} kaldırma` : ''}
      </p>

      {banlayabilir ? (
        <div className="mb-8">
          <BanFormu apiUrl={apiUrl} playerId={player.id} />
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title={`Banlar (${profil.bans.length})`} />
          <CardBody>
            {profil.bans.length === 0 ? (
              <EmptyState title="Ban yok" hint="Bu oyuncunun hiç ban kaydı bulunmuyor." />
            ) : (
              <ul className="flex flex-col gap-3">
                {profil.bans.slice(0, 20).map((b) => (
                  <li key={b.id} className="rounded bg-surface-2 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {b.active ? (
                        <Badge tone="danger">aktif</Badge>
                      ) : b.revokedAt ? (
                        <Badge tone="neutral">kaldırıldı</Badge>
                      ) : (
                        <Badge tone="neutral">süresi doldu</Badge>
                      )}
                      <span className="text-xs text-fg-muted">
                        {tarihSaat(b.createdAt)} · bitiş: {banBitis(b.expiresAt)}
                        {b.issuedByName ? ` · ${b.issuedByName}` : ''}
                        {b.source !== 'altai' ? ` · ${b.source}` : ''}
                      </span>
                    </div>
                    <p className="mt-2 text-sm">{b.reason}</p>
                    {b.internalNote ? (
                      <p className="mt-1 text-xs text-fg-muted">{b.internalNote}</p>
                    ) : null}
                    {b.active && banlayabilir ? (
                      <div className="mt-3">
                        <BanKaldir apiUrl={apiUrl} banId={b.id} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={`Kayıtlar (${profil.records.length})`} />
          <CardBody className="flex flex-col gap-4">
            {notYazabilir ? <KayitFormu apiUrl={apiUrl} playerId={player.id} /> : null}
            {profil.records.length === 0 ? (
              <EmptyState title="Kayıt yok" hint="Not, uyarı ya da takip kaydı yok." />
            ) : (
              <ul className="flex flex-col gap-3">
                {profil.records.map((k) => (
                  <li key={k.id} className="rounded bg-surface-2 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge tone={k.kind === 'warning' ? 'accent' : 'neutral'}>
                          {KAYIT_ETIKET[k.kind]}
                        </Badge>
                        <span className="text-xs text-fg-muted">
                          {tarihSaat(k.createdAt)}
                          {k.authorName ? ` · ${k.authorName}` : ''}
                          {k.resolvedAt ? ' · kapatıldı' : ''}
                        </span>
                      </div>
                      {!k.resolvedAt && notYazabilir ? (
                        <KaydiKapat apiUrl={apiUrl} recordId={k.id} />
                      ) : null}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm">{k.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={`İsim geçmişi (${profil.names.length})`} />
          <CardBody>
            {profil.names.length === 0 ? (
              <EmptyState title="İsim kaydı yok" hint="Bu oyuncu için isim geçmişi yok." />
            ) : (
              <ul className="flex flex-col gap-1.5">
                {profil.names.map((n) => (
                  <li key={n.name} className="flex flex-wrap justify-between gap-2 text-sm">
                    <span>{n.name}</span>
                    <span className="text-xs text-fg-muted">
                      {tarih(n.firstSeen)} – {tarih(n.lastSeen)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </main>
  );
}
