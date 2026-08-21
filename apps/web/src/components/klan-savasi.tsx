'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Klan savaşı lobisi — plan Faz 5.
 *
 * Kadro SteamID listesiyle yönetiliyor (klan yönetimindeki gibi): maç
 * sorumlusu listeyi olduğu gibi yapıştırıyor. Tek tek oyuncu aratmak 20
 * kişilik bir kadro için kullanılamaz bir akış.
 *
 * Ekleme sonucu AYRINTILI gösteriliyor. Yalnızca "eklendi" demek, 20
 * satırlık listenin 3'ünün sessizce düşmesini görünmez kılardı ve o üç
 * kişi maç gecesi sunucuya giremezdi.
 */

export interface Savas {
  id: string;
  serverId: string;
  name: string;
  scheduledAt: string | null;
  status: string;
  lockedAt: string | null;
}

export interface Takim {
  id: string;
  clanId: string;
  side: number;
  clanName: string;
  clanTag: string | null;
}

export interface KadroSatiri {
  playerId: string;
  clanId: string;
  steamId: string | null;
}

export interface Klan {
  id: string;
  name: string;
  tag: string | null;
}

interface EklemeSonucu {
  eklenen: number;
  zatenKadroda: number;
  klanDisi: number;
  gecersiz: string[];
}

const DURUM_ETIKET: Record<string, string> = {
  planned: 'planlandı',
  lobby: 'lobi',
  live: 'CANLI',
  finished: 'bitti',
  cancelled: 'iptal',
};

export function KlanSavasi({
  apiUrl,
  savas,
  takimlar,
  kadro,
  klanlar,
}: {
  apiUrl: string;
  savas: Savas;
  takimlar: Takim[];
  kadro: KadroSatiri[];
  klanlar: Klan[];
}) {
  const router = useRouter();
  const [liste, setListe] = useState('');
  const [seciliKlan, setSeciliKlan] = useState<string>(takimlar[0]?.clanId ?? '');
  const [sonuc, setSonuc] = useState<EklemeSonucu | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [calisiyor, setCalisiyor] = useState(false);

  const kilitli = savas.lockedAt !== null;

  async function istek(yol: string, govde?: unknown) {
    setCalisiyor(true);
    setMesaj(null);
    try {
      const r = await fetch(`${apiUrl}${yol}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        ...(govde ? { body: JSON.stringify(govde) } : {}),
      });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) {
        // Sunucunun kendi hata kodu gösteriliyor: "kadro_bos" gibi bir
        // cevap, neyin eksik olduğunu doğrudan söylüyor.
        setMesaj(
          j.error === 'kadro_bos'
            ? 'Kadro boş — savaş başlatılamaz. Boş kadroyla herkes sunucudan atılırdı.'
            : j.error === 'kadro_kilitli'
              ? 'Kadro kilitli, ekleme yapılamaz.'
              : String(j.error ?? `hata (${r.status})`),
        );
        return null;
      }
      router.refresh();
      return j;
    } catch {
      setMesaj('sunucuya ulaşılamadı');
      return null;
    } finally {
      setCalisiyor(false);
    }
  }

  async function kadroEkle() {
    if (!seciliKlan || !liste.trim()) {
      setMesaj('klan seç ve liste yapıştır');
      return;
    }
    const j = await istek(`/clan-wars/${savas.id}/kadro`, {
      clanId: seciliKlan,
      steamIds: liste,
    });
    if (j) {
      setSonuc(j as unknown as EklemeSonucu);
      setListe('');
    }
  }

  const kadroKlanBazli = new Map<string, number>();
  for (const k of kadro) kadroKlanBazli.set(k.clanId, (kadroKlanBazli.get(k.clanId) ?? 0) + 1);

  return (
    <div className="space-y-6">
      <section className="rounded border border-border bg-surface px-5 py-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="display text-xl">{savas.name}</h2>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              savas.status === 'live' ? 'bg-danger text-danger-fg' : 'bg-accent-weak text-accent-2'
            }`}
          >
            {DURUM_ETIKET[savas.status] ?? savas.status}
          </span>
          {kilitli ? <span className="text-[11px] text-fg-faint">kadro kilitli</span> : null}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {(['lobby', 'live', 'finished', 'cancelled'] as const).map((d) => (
            <Button
              key={d}
              size="sm"
              variant={d === 'live' ? 'danger' : 'soft'}
              disabled={calisiyor || savas.status === d}
              onClick={() => istek(`/clan-wars/${savas.id}/durum`, { status: d })}
            >
              {DURUM_ETIKET[d]}
            </Button>
          ))}
          {kilitli ? null : (
            <Button
              size="sm"
              variant="ghost"
              disabled={calisiyor}
              onClick={() => istek(`/clan-wars/${savas.id}/kilitle`)}
            >
              Kadroyu kilitle
            </Button>
          )}
        </div>

        {savas.status === 'live' ? (
          <p className="mt-3 text-xs text-danger">
            Yaptırım aktif: kadroda olmayan oyuncular uyarılıp sunucudan çıkarılıyor.
          </p>
        ) : null}
        {mesaj ? <p className="mt-2 text-xs text-danger">{mesaj}</p> : null}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">Taraflar</h3>
        {takimlar.length === 0 ? (
          <p className="rounded border border-border bg-surface px-4 py-6 text-center text-sm text-fg-muted">
            Henüz klan eklenmedi.
          </p>
        ) : (
          <ul className="space-y-1">
            {takimlar.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between rounded border border-border bg-surface px-4 py-2 text-sm"
              >
                <span>
                  {t.side}. taraf · {t.clanName}
                  {t.clanTag ? (
                    <span className="ml-1 text-xs text-fg-muted">{t.clanTag}</span>
                  ) : null}
                </span>
                <span className="text-xs text-fg-muted">
                  {kadroKlanBazli.get(t.clanId) ?? 0} kişi
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2 rounded bg-surface p-3">
          <select
            className="rounded border border-border bg-bg px-2 py-1.5 text-sm"
            value={seciliKlan}
            onChange={(e) => setSeciliKlan(e.target.value)}
          >
            <option value="">klan seç</option>
            {klanlar.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
          {([1, 2] as const).map((side) => (
            <Button
              key={side}
              size="sm"
              variant="soft"
              disabled={calisiyor || !seciliKlan}
              onClick={() => istek(`/clan-wars/${savas.id}/takimlar`, { clanId: seciliKlan, side })}
            >
              {side}. tarafa ekle
            </Button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">
          Kadro <span className="text-fg-faint">({kadro.length} kişi)</span>
        </h3>

        {kilitli ? (
          <p className="rounded border border-border bg-surface px-4 py-6 text-center text-sm text-fg-muted">
            Kadro kilitli. Kilit, karşı tarafın kabul ettiği kadronun sabitlendiği an — ekleme
            yapılamaz.
          </p>
        ) : (
          <div className="space-y-2 rounded bg-surface p-3">
            <p className="text-xs text-fg-muted">
              SteamID listesini yapıştır. Satır sonu, virgül ya da boşlukla ayrılmış olabilir; Steam
              profil bağlantısı da kabul edilir. Yukarıdan klan seçmeyi unutma.
            </p>
            <textarea
              className="min-h-28 w-full rounded border border-border bg-bg px-3 py-2 font-mono text-xs"
              value={liste}
              onChange={(e) => setListe(e.target.value)}
              placeholder="76561198000000001&#10;76561198000000002"
            />
            <Button onClick={kadroEkle} disabled={calisiyor}>
              Kadroya ekle
            </Button>

            {sonuc ? (
              <div className="space-y-0.5 text-xs">
                <p className="text-fg">
                  {sonuc.eklenen} eklendi · {sonuc.zatenKadroda} zaten kadroda
                </p>
                {sonuc.klanDisi > 0 ? (
                  // Engellenmiyor ama söyleniyor: ödünç oyuncu klan
                  // savaşlarında yaygın, yanlış liste yapıştırmak da öyle.
                  <p className="text-fg-muted">
                    {sonuc.klanDisi} kişi bu klanın üyesi değil (yine de eklendi)
                  </p>
                ) : null}
                {sonuc.gecersiz.length > 0 ? (
                  <p className="text-danger">
                    okunamadı ya da kayıtlı değil: {sonuc.gecersiz.join(', ')}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </section>
    </div>
  );
}
