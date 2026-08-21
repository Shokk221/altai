'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * Talebi panelden kapatma.
 *
 * Discord thread'i BURADAN arşivlenmiyor — api'nin Discord istemcisi yok.
 * Kayıt kapanıyor ve panelde doğru görünüyor; thread bot tarafından
 * kapatılana kadar açık kalıyor. Bu gecikme kullanıcıya SÖYLENİYOR,
 * çünkü "kapattım ama Discord'da hâlâ açık" sorusunun cevabı görünür
 * olmalı.
 */
export function TalepKapat({ apiUrl, talepId }: { apiUrl: string; talepId: string }) {
  const router = useRouter();
  const [acik, setAcik] = useState(false);
  const [sebep, setSebep] = useState('');
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [calisiyor, setCalisiyor] = useState(false);

  async function kapat() {
    setCalisiyor(true);
    setMesaj(null);
    try {
      const r = await fetch(`${apiUrl}/tickets/${talepId}/kapat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: sebep.trim() || null }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        setMesaj(
          j.error === 'talep_zaten_kapali'
            ? 'Bu talep zaten kapalı.'
            : (j.error ?? `hata (${r.status})`),
        );
        return;
      }
      router.refresh();
    } catch {
      setMesaj('sunucuya ulaşılamadı');
    } finally {
      setCalisiyor(false);
    }
  }

  if (!acik) {
    return (
      <div className="mt-3">
        <Button variant="soft" size="sm" onClick={() => setAcik(true)}>
          Talebi kapat
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded border border-border bg-bg p-3">
      <Input
        placeholder="Kapanış notu (isteğe bağlı)"
        value={sebep}
        onChange={(e) => setSebep(e.target.value)}
      />
      <p className="text-[11px] text-fg-faint">
        Kayıt hemen kapanır. Discord thread'i bot tarafından arşivlenene kadar açık kalabilir.
      </p>
      <div className="flex items-center gap-2">
        <Button variant="danger" size="sm" onClick={kapat} disabled={calisiyor}>
          Kapat
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setAcik(false)} disabled={calisiyor}>
          Vazgeç
        </Button>
        {mesaj ? <span className="text-xs text-danger">{mesaj}</span> : null}
      </div>
    </div>
  );
}
