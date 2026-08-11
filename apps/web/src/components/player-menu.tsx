'use client';

import { cn } from '@/lib/cn';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

/**
 * Oyuncu satırındaki hızlı eylem menüsü.
 *
 * Canlı ekranda moderasyonun ihtiyacı hız: birini atmak için profile gidip
 * geri dönmek üç tık ve bağlam kaybı. Menü satırın yanında açılıyor,
 * eylem aynı yerde bitiyor.
 *
 * Ban BİLEREK yok: süre ve sebep isteyen, kalıcı sonucu olan bir karar —
 * profil ekranında verilmeli. Buradakiler geri alınabilir ya da anlık.
 */

type Eylem = null | 'kick' | 'warn';

export function PlayerMenu({
  apiUrl,
  slug,
  steamId,
  isim,
  kickYetkisi,
  warnYetkisi,
  takimYetkisi,
  takimaAt,
  oyuncuTakimi,
}: {
  apiUrl: string;
  slug: string;
  steamId: string;
  isim: string;
  kickYetkisi: boolean;
  warnYetkisi: boolean;
  takimYetkisi?: boolean;
  /** Takım değiştirme onay kutusunu açar; kutu panelin üstünde duruyor. */
  takimaAt?: (hedefTakim: 1 | 2) => void;
  /** Oyuncunun şu anki takımı — kendi takımı seçenek olarak gösterilmiyor. */
  oyuncuTakimi?: 1 | 2;
}) {
  const [acik, setAcik] = useState(false);
  const [eylem, setEylem] = useState<Eylem>(null);
  const [metin, setMetin] = useState('');
  const [bekliyor, setBekliyor] = useState(false);
  const [sonuc, setSonuc] = useState<string | null>(null);
  const kutu = useRef<HTMLDivElement | null>(null);

  // Dışarı tıklayınca kapansın; menü açık kalırsa listedeki diğer satırlar
  // tıklanamıyor.
  useEffect(() => {
    if (!acik) return;
    const kapat = (e: MouseEvent) => {
      if (kutu.current && !kutu.current.contains(e.target as Node)) {
        setAcik(false);
        setEylem(null);
      }
    };
    document.addEventListener('mousedown', kapat);
    return () => document.removeEventListener('mousedown', kapat);
  }, [acik]);

  async function gonder() {
    if (!eylem) return;
    setBekliyor(true);
    setSonuc(null);
    try {
      const res = await fetch(`${apiUrl}/live/${slug}/${eylem}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ steamId, mesaj: metin.trim() }),
      });
      if (!res.ok) {
        const g = (await res.json().catch(() => ({}))) as { error?: string; detay?: string };
        setSonuc(
          g.error === 'agent_bagli_degil'
            ? 'Agent bağlı değil'
            : g.error === 'komut_basarisiz'
              ? `Komut başarısız (${g.detay ?? '?'})`
              : (g.detay ?? g.error ?? 'Başarısız'),
        );
        return;
      }
      // Kapatıp temizliyoruz: başarı mesajını beklemek akışı yavaşlatıyor,
      // sonucu zaten akışta (oyuncu çıktı) görüyorsunuz.
      setAcik(false);
      setEylem(null);
      setMetin('');
    } catch {
      setSonuc('Sunucuya ulaşılamadı');
    } finally {
      setBekliyor(false);
    }
  }

  if (!kickYetkisi && !warnYetkisi && !takimYetkisi) {
    return null;
  }

  return (
    <div ref={kutu} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          setAcik((o) => !o);
        }}
        aria-label={`${isim} için işlemler`}
        className={cn(
          'rounded px-1 text-[13px] leading-none text-fg-faint transition-colors hover:text-fg',
          acik && 'text-fg',
        )}
      >
        ⋯
      </button>

      {acik ? (
        <div className="absolute right-0 top-5 z-30 w-56 rounded-sm border border-border-strong bg-surface p-1 shadow-lift">
          {eylem === null ? (
            <div className="flex flex-col">
              <Link
                href={`/oyuncular?q=${steamId}`}
                className="rounded-sm px-2.5 py-1.5 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                Profili aç
              </Link>
              {warnYetkisi ? (
                <button
                  type="button"
                  onClick={() => setEylem('warn')}
                  className="rounded-sm px-2.5 py-1.5 text-left text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg"
                >
                  Uyar
                </button>
              ) : null}
              {/* İki takım da açıkça yazılı. "Karşı takıma at" tek oyuncuda
                  netti ama çoklu seçimde belirsizdi: iki taraftan seçilmiş
                  oyuncular için "karşı" diye bir yön yok. */}
              {takimYetkisi && takimaAt
                ? ([1, 2] as const)
                    .filter((t) => t !== oyuncuTakimi)
                    .map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setAcik(false);
                          takimaAt(t);
                        }}
                        className="rounded-sm px-2.5 py-1.5 text-left text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg"
                      >
                        Takım {t}'e al
                      </button>
                    ))
                : null}
              {kickYetkisi ? (
                <button
                  type="button"
                  onClick={() => setEylem('kick')}
                  className="rounded-sm px-2.5 py-1.5 text-left text-[13px] text-danger hover:bg-danger-weak"
                >
                  Sunucudan at
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(steamId);
                  setAcik(false);
                }}
                className="rounded-sm px-2.5 py-1.5 text-left text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg"
              >
                SteamID kopyala
              </button>
            </div>
          ) : (
            <div className="p-1.5">
              <p className="mb-1.5 text-[11px] text-fg-faint">
                {eylem === 'kick' ? 'Atma sebebi' : 'Uyarı metni'} — {isim}
              </p>
              <input
                value={metin}
                onChange={(e) => setMetin(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && metin.trim()) void gonder();
                  if (e.key === 'Escape') setEylem(null);
                }}
                placeholder={eylem === 'kick' ? 'Oyuncuya gösterilir' : 'Ekranda görecek'}
                className="w-full rounded-sm border border-border-strong bg-surface-sunken px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
              />
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  onClick={gonder}
                  disabled={bekliyor || metin.trim().length === 0}
                  className={cn(
                    'rounded-full px-3 py-1 text-[12px] font-medium disabled:opacity-40',
                    eylem === 'kick' ? 'bg-danger text-danger-fg' : 'bg-ink text-ink-fg',
                  )}
                >
                  {bekliyor ? '…' : eylem === 'kick' ? 'At' : 'Gönder'}
                </button>
                <button
                  type="button"
                  onClick={() => setEylem(null)}
                  className="rounded-full px-3 py-1 text-[12px] text-fg-muted hover:text-fg"
                >
                  Geri
                </button>
              </div>
              {sonuc ? <p className="mt-1.5 text-[11px] text-danger">{sonuc}</p> : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
