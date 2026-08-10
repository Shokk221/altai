'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Maç sonuna ertelenmiş takım değişimleri.
 *
 * Onay kutusu "maç bitene kadar iptal edilebilir" diyor; bu ekran o sözün
 * karşılığı. Olmasaydı yetkili kararını geri alamaz, üstelik başka bir
 * yetkili kimin bekletildiğini hiç göremezdi — ve maç bitince sürpriz
 * olurdu.
 *
 * Yalnızca bekleyen VARSA görünüyor: boş bir kutu üst çubukta yer
 * kaplamamalı.
 */

interface Bekleyen {
  id: string;
  steamId: string;
  playerName: string | null;
  fromTeam: string | null;
  requestedByName: string | null;
  createdAt: string;
}

export function BekleyenTakim({
  apiUrl,
  slug,
  yetki,
}: {
  apiUrl: string;
  slug: string | null;
  yetki: boolean;
}) {
  const [liste, setListe] = useState<Bekleyen[]>([]);
  const [acik, setAcik] = useState(false);
  const kutu = useRef<HTMLDivElement | null>(null);

  const getir = useCallback(async () => {
    if (!slug || !yetki) return;
    try {
      const res = await fetch(`${apiUrl}/live/${slug}/takim/bekleyen`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const veri = (await res.json()) as { bekleyenler: Bekleyen[] };
      setListe(veri.bekleyenler);
    } catch {
      // Sessiz: bu bilgi ikincil, hata göstermek panelin geri kalanını
      // gölgelerdi.
    }
  }, [apiUrl, slug, yetki]);

  // Maç sonunda kuyruk boşalıyor ve başka yetkililer de ekleyebiliyor;
  // 30 sn'de bir tazeleniyor. WS'e bağlamak için olay tipi eklemek
  // gerekirdi, bu bilgi o kadar sıcak değil.
  useEffect(() => {
    void getir();
    const t = setInterval(() => void getir(), 30_000);
    return () => clearInterval(t);
  }, [getir]);

  useEffect(() => {
    if (!acik) return;
    const kapat = (e: MouseEvent) => {
      if (kutu.current && !kutu.current.contains(e.target as Node)) setAcik(false);
    };
    document.addEventListener('mousedown', kapat);
    return () => document.removeEventListener('mousedown', kapat);
  }, [acik]);

  async function iptal(id: string) {
    // İyimser çıkarma: sunucu hata dönerse bir sonraki tazeleme geri
    // koyuyor, ama beklemek listeyi donmuş gösteriyordu.
    setListe((o) => o.filter((b) => b.id !== id));
    await fetch(`${apiUrl}/live/${slug}/takim/${id}/iptal`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
    void getir();
  }

  if (!yetki || liste.length === 0) return null;

  return (
    <div ref={kutu} className="relative">
      <button
        type="button"
        onClick={() => setAcik((o) => !o)}
        className="rounded-full border border-warn/40 px-2.5 py-1 text-[11px] font-semibold text-warn hover:bg-warn/10"
      >
        maç sonu: {liste.length}
      </button>

      {acik ? (
        <div className="absolute left-0 top-7 z-40 w-72 rounded-sm border border-border-strong bg-surface p-1 shadow-lift">
          <p className="px-2.5 py-1.5 text-[11px] text-fg-faint">
            Maç bitince karşı takıma alınacaklar
          </p>
          <ul className="max-h-64 overflow-y-auto">
            {liste.map((b) => (
              <li
                key={b.id}
                className="flex items-baseline gap-2 rounded-sm px-2.5 py-1.5 text-[13px] hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1 truncate">
                  {b.playerName ?? b.steamId}
                  {b.requestedByName ? (
                    <span className="ml-1.5 text-[11px] text-fg-faint">{b.requestedByName}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => void iptal(b.id)}
                  className="shrink-0 text-[12px] text-fg-muted hover:text-danger"
                >
                  iptal
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
