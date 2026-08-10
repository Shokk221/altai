'use client';

import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/**
 * Etiket atama seçicisi.
 *
 * Etiket kaldırma vardı, atama yoktu — API hazırdı ama arayüzde karşılığı
 * bulunmuyordu. Etiketler künye bandında duruyor; seçici de oraya, kapalıyken
 * tek düğme olacak şekilde yerleşiyor.
 *
 * Liste açıldığında yükleniyor: 14 etiket için her profil açılışında ekstra
 * istek atmanın anlamı yok.
 */

interface Flag {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
}

export function FlagPicker({
  apiUrl,
  playerId,
  atanmisIdler,
}: {
  apiUrl: string;
  playerId: string;
  atanmisIdler: string[];
}) {
  const router = useRouter();
  const [acik, setAcik] = useState(false);
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [bekleyen, setBekleyen] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  useEffect(() => {
    if (!acik || flags) return;
    let iptal = false;
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/flags`, { credentials: 'include' });
        if (iptal) return;
        if (!res.ok) {
          setHata('Etiketler getirilemedi');
          return;
        }
        const veri = (await res.json()) as { flags: Flag[] };
        setFlags(veri.flags);
      } catch {
        if (!iptal) setHata('Sunucuya ulaşılamadı');
      }
    })();
    return () => {
      iptal = true;
    };
  }, [acik, flags, apiUrl]);

  async function ata(flagId: string) {
    setBekleyen(flagId);
    setHata(null);
    try {
      const res = await fetch(`${apiUrl}/players/${playerId}/flags`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ flagId }),
      });
      if (!res.ok) {
        const g = (await res.json().catch(() => ({}))) as { error?: string };
        setHata(g.error === 'flag_zaten_atanmis' ? 'Bu etiket zaten var' : 'Etiket atanamadı');
        return;
      }
      setAcik(false);
      router.refresh();
    } catch {
      setHata('Sunucuya ulaşılamadı');
    } finally {
      setBekleyen(null);
    }
  }

  if (!acik) {
    return (
      <button
        type="button"
        onClick={() => setAcik(true)}
        className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-fg-muted transition-colors hover:text-fg"
      >
        + etiket
      </button>
    );
  }

  const secilebilir = (flags ?? []).filter((f) => !atanmisIdler.includes(f.id));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {flags === null ? (
        <span className="text-[11px] text-fg-muted">yükleniyor…</span>
      ) : secilebilir.length === 0 ? (
        <span className="text-[11px] text-fg-muted">atanabilecek etiket kalmadı</span>
      ) : (
        secilebilir.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => ata(f.id)}
            disabled={bekleyen !== null}
            title={f.description ?? undefined}
            className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-medium text-fg transition-colors hover:bg-accent-weak hover:text-accent-2 disabled:opacity-40"
          >
            {bekleyen === f.id ? '…' : f.name}
          </button>
        ))
      )}
      <Button variant="ghost" size="sm" onClick={() => setAcik(false)}>
        kapat
      </Button>
      {hata ? <span className="text-[11px] font-medium text-danger">{hata}</span> : null}
    </div>
  );
}
