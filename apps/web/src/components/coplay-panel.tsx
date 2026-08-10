'use client';

import { sure } from '@/lib/format';
import Link from 'next/link';
import { useState } from 'react';

/**
 * Birlikte oynadıkları.
 *
 * İSTEK ÜZERİNE yükleniyor, profille birlikte değil: hesap oturumların
 * zaman kesişiminden çıkıyor ve 417 bin satır tarıyor. Her profil açılışında
 * çalıştırmak, hiç bakılmayacak bir veri için herkesi bekletmek olurdu.
 */

interface Arkadas {
  playerId: string;
  name: string;
  steamId: string | null;
  birlikteSaniye: number;
  oturum: number;
}

export function CoplayPanel({ apiUrl, playerId }: { apiUrl: string; playerId: string }) {
  const [durum, setDurum] = useState<'bos' | 'yukleniyor' | 'hazir' | 'hata'>('bos');
  const [liste, setListe] = useState<Arkadas[]>([]);

  async function yukle() {
    setDurum('yukleniyor');
    try {
      const res = await fetch(`${apiUrl}/players/${playerId}/coplay`, { credentials: 'include' });
      if (!res.ok) {
        setDurum('hata');
        return;
      }
      const veri = (await res.json()) as { coplay: Arkadas[] };
      setListe(veri.coplay);
      setDurum('hazir');
    } catch {
      setDurum('hata');
    }
  }

  if (durum === 'bos') {
    return (
      <div className="py-4 text-center">
        <button
          type="button"
          onClick={yukle}
          className="rounded-full bg-surface-2 px-4 py-2 text-xs font-semibold text-fg-muted transition-colors hover:text-fg"
        >
          Birlikte oynadıklarını göster
        </button>
        <p className="mt-2 text-[11px] text-fg-muted">son 90 gün · 1 saatten uzun</p>
      </div>
    );
  }

  if (durum === 'yukleniyor') {
    return <p className="py-6 text-center text-xs text-fg-muted">Hesaplanıyor…</p>;
  }

  if (durum === 'hata') {
    return <p className="py-6 text-center text-xs text-danger">Hesaplanamadı</p>;
  }

  if (liste.length === 0) {
    return (
      <p className="py-6 text-center text-xs text-fg-muted">
        Son 90 günde birlikte oynadığı kimse yok
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {liste.map((a) => (
        <li key={a.playerId}>
          <Link
            href={`/oyuncular/${a.playerId}`}
            className="flex items-baseline justify-between gap-3 rounded-sm px-1 py-1.5 text-[13px] transition-colors hover:bg-surface-2"
          >
            <span className="truncate">{a.name}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-fg-muted">
              {sure(a.birlikteSaniye)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
