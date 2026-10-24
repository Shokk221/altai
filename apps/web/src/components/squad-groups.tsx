'use client';

import { IzinSecici, hataMetni } from '@/components/izin-secici';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { SQUAD_IZNI, SQUAD_KUMELERI, squadIzniAdi } from '@/lib/yetki-etiketleri';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Oyun içi gruplar — Admins.cfg'deki `Group=<ad>:<izinler>` satırları.
 *
 * Önce panelden düzenlenemiyordu: gruplar eski sistemden içe aktarılmıştı
 * ve bir yetkiliye kamera izni eklemek veritabanına elle yazmak demekti.
 *
 * İki tür var ve ekranda AYRI anlatılıyor, çünkü karıştırılması yetki
 * sızıntısı demek:
 *   Yetkili   — yalnızca Discord rolüyle verilir; rol alınınca düşer.
 *   Whitelist — yalnızca rezerve slot; elle de verilebilir.
 */

export interface SquadGroup {
  id: string;
  name: string;
  squadPermissions: string[];
  grantMode: 'discord' | 'manual';
  serverId: string | null;
  eslemeSayisi: number;
  grantSayisi: number;
}

const TUR: Record<SquadGroup['grantMode'], { ad: string; aciklama: string }> = {
  discord: {
    ad: 'Yetkili',
    aciklama: 'Yalnızca Discord rolüyle verilir. Rol alınınca oyundaki yetki de düşer.',
  },
  manual: {
    ad: 'Whitelist',
    aciklama: 'Yalnızca rezerve slot. Discord rolüyle de, panelden elle de verilebilir.',
  },
};

export function SquadGroups({ apiUrl, gruplar }: { apiUrl: string; gruplar: SquadGroup[] }) {
  const [duzenlenen, setDuzenlenen] = useState<SquadGroup | 'yeni' | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[60ch] text-footnote text-fg-muted">
          Oyunda kimin neyi yapabileceği. Bir Discord rolüne grup bağlandığında o rolü taşıyan
          herkes oyunda bu izinleri alır.
        </p>
        {duzenlenen === null ? (
          <Button size="sm" onClick={() => setDuzenlenen('yeni')}>
            Yeni grup
          </Button>
        ) : null}
      </div>

      {duzenlenen === 'yeni' ? (
        <GrupFormu apiUrl={apiUrl} mevcut={null} kapat={() => setDuzenlenen(null)} />
      ) : null}

      {gruplar.length === 0 ? (
        <p className="rounded border border-border bg-surface px-5 py-8 text-center text-sm text-fg-muted">
          Henüz oyun içi grup yok. Bir grup oluşturup Discord rolüne bağladığınızda o rolü
          taşıyanlar oyunda yetki alır.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {gruplar.map((g) =>
            duzenlenen !== 'yeni' && duzenlenen?.id === g.id ? (
              <li key={g.id}>
                <GrupFormu apiUrl={apiUrl} mevcut={g} kapat={() => setDuzenlenen(null)} />
              </li>
            ) : (
              <li key={g.id} className="rounded border border-border bg-surface px-5 py-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  <span className="font-semibold">{g.name}</span>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-2xs font-medium',
                      g.grantMode === 'discord'
                        ? 'bg-accent-weak text-accent-2'
                        : 'bg-surface-2 text-fg-muted',
                    )}
                  >
                    {TUR[g.grantMode].ad}
                  </span>
                  {g.serverId ? (
                    <span className="text-2xs text-fg-faint">yalnızca bir sunucuda</span>
                  ) : null}
                  <span className="ml-auto text-2xs text-fg-faint">
                    {g.eslemeSayisi} Discord rolü
                    {g.grantMode === 'manual' ? ` · ${g.grantSayisi} elle kayıt` : ''}
                  </span>
                </div>
                <p className="mt-2 text-footnote text-fg-muted">
                  {g.squadPermissions.length === 0
                    ? 'Hiç izin yok'
                    : g.squadPermissions.map(squadIzniAdi).join(' · ')}
                </p>
                {duzenlenen === null ? (
                  <div className="mt-3">
                    <Button size="sm" variant="soft" onClick={() => setDuzenlenen(g)}>
                      Düzenle
                    </Button>
                  </div>
                ) : null}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function GrupFormu({
  apiUrl,
  mevcut,
  kapat,
}: {
  apiUrl: string;
  mevcut: SquadGroup | null;
  kapat: () => void;
}) {
  const router = useRouter();
  const [ad, setAd] = useState(mevcut?.name ?? '');
  const [tur, setTur] = useState<SquadGroup['grantMode']>(mevcut?.grantMode ?? 'discord');
  const [izinler, setIzinler] = useState<string[]>(mevcut?.squadPermissions ?? []);
  const [bekliyor, setBekliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const izinDegistir = (p: string) =>
    setIzinler((o) => (o.includes(p) ? o.filter((x) => x !== p) : [...o, p]));

  // Whitelist grubunda rezerve slot dışında bir şey seçilemiyor; önceden
  // seçili kalanlar kaldırılabiliyor ama yenisi eklenemiyor (bkz.
  // IzinSecici). Kaydetmeye basınca reddedilmek yerine burada görünüyor.
  const kilitli = (p: string) =>
    tur === 'manual' && p !== 'reserve' ? 'Whitelist grubu yalnızca rezerve slot verebilir' : null;
  const uyumsuz = tur === 'manual' && izinler.some((p) => p !== 'reserve');

  const kullaniliyor = mevcut !== null && (mevcut.eslemeSayisi > 0 || mevcut.grantSayisi > 0);

  async function kaydet() {
    setBekliyor(true);
    setHata(null);
    try {
      const res = await fetch(
        mevcut ? `${apiUrl}/squad-groups/${mevcut.id}` : `${apiUrl}/squad-groups`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ...(mevcut ? {} : { name: ad.trim() }),
            squadPermissions: izinler,
            grantMode: tur,
          }),
        },
      );
      if (!res.ok) {
        setHata(await hataMetni(res, 'Kaydedilemedi'));
        return;
      }
      kapat();
      router.refresh();
    } catch {
      setHata('Sunucuya ulaşılamadı');
    } finally {
      setBekliyor(false);
    }
  }

  async function sil() {
    if (!mevcut) return;
    setBekliyor(true);
    setHata(null);
    try {
      const res = await fetch(`${apiUrl}/squad-groups/${mevcut.id}/delete`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        setHata(await hataMetni(res, 'Silinemedi'));
        return;
      }
      kapat();
      router.refresh();
    } catch {
      setHata('Sunucuya ulaşılamadı');
    } finally {
      setBekliyor(false);
    }
  }

  return (
    <div className="rounded border border-accent-line bg-surface p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        {mevcut ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-fg-muted">Grup adı</span>
            <span className="text-subhead font-semibold">{mevcut.name}</span>
            <span className="text-2xs text-fg-faint">
              Ad değişmez: rollere ve kayıtlara adıyla bağlı.
            </span>
          </div>
        ) : (
          <label htmlFor="grup-adi" className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-fg-muted">Grup adı</span>
            <Input
              id="grup-adi"
              value={ad}
              onChange={(e) => setAd(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))}
              placeholder="KidemliAdmin"
              maxLength={32}
            />
            <span className="text-2xs text-fg-faint">Harf, rakam ve alt çizgi. Boşluk yok.</span>
          </label>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-fg-muted">Tür</span>
          <div className="grid grid-cols-2 gap-1 rounded-full bg-surface-sunken p-1">
            {(['discord', 'manual'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTur(t)}
                aria-pressed={tur === t}
                className={cn(
                  'rounded-full py-1.5 text-footnote transition-colors',
                  tur === t ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
                )}
              >
                {TUR[t].ad}
              </button>
            ))}
          </div>
          <span className="text-2xs text-fg-faint">{TUR[tur].aciklama}</span>
        </div>
      </div>

      <div className="mt-5">
        <IzinSecici
          kumeler={SQUAD_KUMELERI}
          sozluk={SQUAD_IZNI}
          secili={izinler}
          degistir={izinDegistir}
          kilitli={kilitli}
        />
      </div>

      {uyumsuz ? (
        <p className="mt-3 text-footnote text-warn">
          Whitelist grubunda rezerve slot dışındaki izinler kaldırılmalı.
        </p>
      ) : null}
      {hata ? <p className="mt-3 text-footnote font-medium text-danger">{hata}</p> : null}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button
          onClick={kaydet}
          disabled={bekliyor || uyumsuz || (!mevcut && ad.trim().length === 0)}
        >
          {bekliyor ? 'Kaydediliyor…' : 'Kaydet'}
        </Button>
        <Button variant="ghost" onClick={kapat} disabled={bekliyor}>
          Vazgeç
        </Button>
        {mevcut ? (
          <Button
            variant="ghost"
            onClick={sil}
            disabled={bekliyor || kullaniliyor}
            title={kullaniliyor ? 'Bu gruba bağlı rol ya da kayıt var' : undefined}
            className="ml-auto text-danger hover:text-danger"
          >
            Grubu sil
          </Button>
        ) : null}
      </div>
    </div>
  );
}
