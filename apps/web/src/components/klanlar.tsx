'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Klan yönetimi.
 *
 * Üyelik SteamID listesiyle yönetiliyor: klan sorumlusu listeyi olduğu gibi
 * yapıştırıyor. Tek tek oyuncu aratıp eklemek 40 kişilik bir klan için
 * kullanılamaz bir akış — eski sistemde de listeler dosyadan geliyordu.
 *
 * Ekleme sonucu AYRINTILI gösteriliyor: kaç kişi eklendi, kaçı zaten
 * üyeydi, hangileri okunamadı. Yalnızca "eklendi" demek, 40 satırlık bir
 * listenin 6'sının sessizce düşmesini görünmez kılardı.
 */

export interface Klan {
  id: string;
  name: string;
  tag: string | null;
  color: string | null;
  uyeSayisi: number;
}

export interface Uye {
  playerId: string;
  steamId: string | null;
  eosId: string | null;
  addedAt: string;
}

interface EklemeSonucu {
  eklenen: number;
  zatenUye: number;
  olusturulanOyuncu: number;
  gecersiz: string[];
}

export function Klanlar({ apiUrl, klanlar }: { apiUrl: string; klanlar: Klan[] }) {
  const router = useRouter();
  const [secili, setSecili] = useState<Klan | null>(null);
  const [uyeler, setUyeler] = useState<Uye[] | null>(null);
  const [yeniAd, setYeniAd] = useState('');
  const [yeniEtiket, setYeniEtiket] = useState('');
  const [liste, setListe] = useState('');
  const [sonuc, setSonuc] = useState<EklemeSonucu | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);

  async function istek(yol: string, init?: RequestInit) {
    const res = await fetch(`${apiUrl}${yol}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
    if (!res.ok) {
      const govde = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(govde.error ?? `istek başarısız (${res.status})`);
    }
    return res.json();
  }

  async function klanSec(k: Klan) {
    setSecili(k);
    setUyeler(null);
    setSonuc(null);
    setHata(null);
    try {
      const veri = (await istek(`/clans/${k.id}/members`)) as { members: Uye[] };
      setUyeler(veri.members);
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'üyeler yüklenemedi');
    }
  }

  async function klanOlustur() {
    if (!yeniAd.trim()) return;
    setBekliyor(true);
    setHata(null);
    try {
      await istek('/clans', {
        method: 'POST',
        body: JSON.stringify({
          name: yeniAd.trim(),
          tag: yeniEtiket.trim() || null,
        }),
      });
      setYeniAd('');
      setYeniEtiket('');
      router.refresh();
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'klan oluşturulamadı');
    } finally {
      setBekliyor(false);
    }
  }

  async function uyeEkle() {
    if (!secili || !liste.trim()) return;
    setBekliyor(true);
    setHata(null);
    try {
      const r = (await istek(`/clans/${secili.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ steamIds: liste }),
      })) as EklemeSonucu;
      setSonuc(r);
      setListe('');
      await klanSec(secili);
      router.refresh();
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'üyeler eklenemedi');
    } finally {
      setBekliyor(false);
    }
  }

  async function uyeCikar(steamId: string) {
    if (!secili) return;
    setBekliyor(true);
    setHata(null);
    try {
      await istek(`/clans/${secili.id}/members`, {
        method: 'DELETE',
        body: JSON.stringify({ steamIds: steamId }),
      });
      await klanSec(secili);
      router.refresh();
    } catch (e) {
      setHata(e instanceof Error ? e.message : 'üye çıkarılamadı');
    } finally {
      setBekliyor(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[280px_1fr]">
      <section>
        <h2 className="mb-3 text-sm font-semibold text-fg-muted">Klanlar</h2>

        <ul className="space-y-1">
          {klanlar.map((k) => (
            <li key={k.id}>
              <button
                type="button"
                onClick={() => void klanSec(k)}
                className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm ${
                  secili?.id === k.id ? 'bg-accent-weak text-accent' : 'hover:bg-surface'
                }`}
              >
                <span>
                  {k.name}
                  {k.tag ? <span className="ml-1 text-xs text-fg-muted">{k.tag}</span> : null}
                </span>
                <span className="text-xs text-fg-muted">{k.uyeSayisi}</span>
              </button>
            </li>
          ))}
          {klanlar.length === 0 ? (
            <li className="px-3 py-2 text-sm text-fg-muted">Henüz klan yok.</li>
          ) : null}
        </ul>

        <div className="mt-5 space-y-2 rounded bg-surface p-3">
          <p className="text-xs font-semibold text-fg-muted">Yeni klan</p>
          <Input
            value={yeniAd}
            onChange={(e) => setYeniAd(e.target.value)}
            placeholder="Klan adı"
          />
          <Input
            value={yeniEtiket}
            onChange={(e) => setYeniEtiket(e.target.value)}
            placeholder="Etiket (opsiyonel)"
          />
          <Button onClick={() => void klanOlustur()} disabled={bekliyor || !yeniAd.trim()}>
            Oluştur
          </Button>
        </div>
      </section>

      <section>
        {!secili ? (
          <p className="rounded bg-surface px-5 py-8 text-center text-sm text-fg-muted">
            Üyelerini görmek için soldan bir klan seç.
          </p>
        ) : (
          <>
            <header className="mb-4">
              <h2 className="display text-xl">{secili.name}</h2>
              <p className="mt-1 text-sm text-fg-muted">
                {secili.uyeSayisi} üye
                {secili.tag ? ` · etiket ${secili.tag}` : ''}
              </p>
            </header>

            <div className="mb-6 space-y-2 rounded bg-surface p-4">
              <p className="text-sm font-semibold">Üye ekle</p>
              <p className="text-xs text-fg-muted">
                SteamID listesini yapıştır. Satır sonu, virgül ya da boşlukla ayrılmış olabilir;
                Steam profil bağlantısı da kabul edilir.
              </p>
              <textarea
                value={liste}
                onChange={(e) => setListe(e.target.value)}
                rows={6}
                className="w-full rounded border border-border bg-bg px-3 py-2 font-mono text-xs"
                placeholder={
                  '76561190000000001\nhttps://steamcommunity.com/profiles/76561190000000002'
                }
              />
              <Button onClick={() => void uyeEkle()} disabled={bekliyor || !liste.trim()}>
                Ekle
              </Button>

              {sonuc ? (
                <div className="mt-2 rounded bg-bg px-3 py-2 text-xs">
                  <p>
                    <strong>{sonuc.eklenen}</strong> üye eklendi
                    {sonuc.zatenUye > 0 ? `, ${sonuc.zatenUye} kişi zaten üyeydi` : ''}
                    {sonuc.olusturulanOyuncu > 0
                      ? `, ${sonuc.olusturulanOyuncu} yeni oyuncu kaydı açıldı`
                      : ''}
                    .
                  </p>
                  {sonuc.gecersiz.length > 0 ? (
                    // Okunamayan satırlar görünmezse, 40 satırlık bir
                    // listenin 6'sının düştüğü fark edilmez.
                    <p className="mt-1 text-danger">
                      Okunamadı ({sonuc.gecersiz.length}): {sonuc.gecersiz.slice(0, 10).join(', ')}
                      {sonuc.gecersiz.length > 10 ? ' …' : ''}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {uyeler === null ? (
              <p className="text-sm text-fg-muted">Üyeler yükleniyor…</p>
            ) : uyeler.length === 0 ? (
              <p className="rounded bg-surface px-5 py-8 text-center text-sm text-fg-muted">
                Bu klanda henüz üye yok.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-fg-muted">
                    <th className="pb-2">SteamID</th>
                    <th className="pb-2">Eklendi</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {uyeler.map((u) => (
                    <tr key={u.playerId} className="border-b border-border">
                      <td className="py-2 font-mono text-xs">{u.steamId ?? '—'}</td>
                      <td className="py-2 text-xs text-fg-muted">
                        {new Date(u.addedAt).toLocaleDateString('tr-TR')}
                      </td>
                      <td className="py-2 text-right">
                        {u.steamId ? (
                          <button
                            type="button"
                            onClick={() => void uyeCikar(u.steamId as string)}
                            disabled={bekliyor}
                            className="text-xs text-danger hover:underline"
                          >
                            Çıkar
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}

        {hata ? <p className="mt-3 text-sm text-danger">{hata}</p> : null}
      </section>
    </div>
  );
}
