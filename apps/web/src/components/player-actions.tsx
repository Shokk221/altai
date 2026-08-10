'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';

/**
 * Oyuncu profilindeki yazma eylemleri.
 *
 * Hepsi aynı kalıbı izliyor: istek at, hata varsa AYNI YERDE göster, başarılı
 * olursa sayfayı tazele. Hata mesajını üstte tek bir yere toplamak, hangi
 * eylemin başarısız olduğunu belirsiz bırakıyordu.
 */

const API_HATALARI: Record<string, string> = {
  gecersiz_girdi: 'Girdi geçersiz',
  oyuncu_bulunamadi: 'Oyuncu bulunamadı',
  ban_bulunamadi: 'Ban bulunamadı',
  ban_zaten_kaldirilmis: 'Bu ban zaten kaldırılmış',
  flag_zaten_atanmis: 'Bu etiket zaten atanmış',
  acik_kayit_bulunamadi: 'Açık kayıt bulunamadı',
  bitis_gecmiste: 'Bitiş tarihi geçmişte olamaz',
  forbidden: 'Bu işlem için yetkiniz yok',
  no_session: 'Oturum bulunamadı, tekrar giriş yapın',
  invalid_session: 'Oturum geçersiz, tekrar giriş yapın',
};

function mesaj(kod: unknown, detay?: unknown): string {
  const k = typeof kod === 'string' ? kod : '';
  const temel = API_HATALARI[k] ?? k ?? 'Beklenmeyen hata';
  return typeof detay === 'string' && detay ? `${temel} — ${detay}` : temel;
}

function useEylem(apiUrl: string) {
  const router = useRouter();
  const [bekliyor, setBekliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  async function calistir(yol: string, govde?: unknown): Promise<boolean> {
    setBekliyor(true);
    setHata(null);
    try {
      const res = await fetch(`${apiUrl}${yol}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(govde ?? {}),
      });
      if (!res.ok) {
        const g = (await res.json().catch(() => ({}))) as { error?: unknown; detay?: unknown };
        setHata(mesaj(g.error, g.detay));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setHata('Sunucuya ulaşılamadı');
      return false;
    } finally {
      setBekliyor(false);
    }
  }

  return { calistir, bekliyor, hata, setHata };
}

function Hata({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="mt-2 text-sm font-medium text-danger">{children}</p>;
}

// --------------------------------------------------------------------- ban
export function BanFormu({ apiUrl, playerId }: { apiUrl: string; playerId: string }) {
  const { calistir, bekliyor, hata } = useEylem(apiUrl);
  const [acik, setAcik] = useState(false);
  const [sebep, setSebep] = useState('');
  // Süre gün olarak; boş = kalıcı. Tarih girdisi yerine gün, moderasyonda
  // çok daha hızlı: "3 gün" yazmak takvim açmaktan kolay.
  const [gun, setGun] = useState('');

  if (!acik) {
    return (
      <Button variant="danger" onClick={() => setAcik(true)}>
        Ban at
      </Button>
    );
  }

  const gonder = async () => {
    const g = Number(gun);
    const expiresAt =
      gun.trim() === '' ? null : new Date(Date.now() + Math.max(1, g) * 86_400_000).toISOString();
    const ok = await calistir(`/players/${playerId}/bans`, { reason: sebep.trim(), expiresAt });
    if (ok) {
      setAcik(false);
      setSebep('');
      setGun('');
    }
  };

  return (
    <div className="w-full rounded bg-surface-2 p-4">
      <p className="mb-3 text-sm font-semibold">Ban at</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Sebep (oyuncuya gösterilir)"
          value={sebep}
          onChange={(e) => setSebep(e.target.value)}
          className="flex-1"
        />
        <Input
          placeholder="Gün (boş = kalıcı)"
          inputMode="numeric"
          value={gun}
          onChange={(e) => setGun(e.target.value.replace(/\D/g, ''))}
          className="sm:w-44"
        />
      </div>
      <div className="mt-3 flex gap-2">
        <Button variant="danger" onClick={gonder} disabled={bekliyor || sebep.trim().length < 3}>
          {bekliyor ? 'Uygulanıyor…' : 'Banla'}
        </Button>
        <Button variant="ghost" onClick={() => setAcik(false)} disabled={bekliyor}>
          Vazgeç
        </Button>
      </div>
      <Hata>{hata}</Hata>
    </div>
  );
}

export function BanKaldir({ apiUrl, banId }: { apiUrl: string; banId: string }) {
  const { calistir, bekliyor, hata } = useEylem(apiUrl);
  return (
    <div>
      <Button
        variant="soft"
        size="sm"
        onClick={() => calistir(`/bans/${banId}/revoke`)}
        disabled={bekliyor}
      >
        {bekliyor ? 'Kaldırılıyor…' : 'Banı kaldır'}
      </Button>
      <Hata>{hata}</Hata>
    </div>
  );
}

// ----------------------------------------------------------------- kayıtlar
const KAYIT_TURLERI = [
  { kind: 'note', etiket: 'Not' },
  { kind: 'warning', etiket: 'Uyarı' },
  { kind: 'watchlist', etiket: 'Takip' },
] as const;

export function KayitFormu({ apiUrl, playerId }: { apiUrl: string; playerId: string }) {
  const { calistir, bekliyor, hata } = useEylem(apiUrl);
  const [kind, setKind] = useState<(typeof KAYIT_TURLERI)[number]['kind']>('note');
  const [metin, setMetin] = useState('');

  const gonder = async () => {
    const ok = await calistir(`/players/${playerId}/records`, { kind, body: metin.trim() });
    if (ok) setMetin('');
  };

  return (
    <div className="rounded bg-surface-2 p-4">
      <div className="mb-3 flex gap-2">
        {KAYIT_TURLERI.map((t) => (
          <Button
            key={t.kind}
            size="sm"
            variant={kind === t.kind ? 'accent' : 'ghost'}
            onClick={() => setKind(t.kind)}
          >
            {t.etiket}
          </Button>
        ))}
      </div>
      <textarea
        value={metin}
        onChange={(e) => setMetin(e.target.value)}
        rows={3}
        placeholder="Ne oldu?"
        className="w-full rounded bg-surface px-4 py-3 text-base text-fg placeholder:text-fg-muted/70 focus-visible:outline-none sm:text-sm"
      />
      <div className="mt-3">
        <Button onClick={gonder} disabled={bekliyor || metin.trim().length === 0}>
          {bekliyor ? 'Ekleniyor…' : 'Ekle'}
        </Button>
      </div>
      <Hata>{hata}</Hata>
    </div>
  );
}

export function KaydiKapat({ apiUrl, recordId }: { apiUrl: string; recordId: string }) {
  const { calistir, bekliyor, hata } = useEylem(apiUrl);
  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => calistir(`/records/${recordId}/resolve`)}
        disabled={bekliyor}
      >
        {bekliyor ? '…' : 'Kapat'}
      </Button>
      <Hata>{hata}</Hata>
    </div>
  );
}

// ------------------------------------------------------------------ etiket
export function EtiketKaldir({ apiUrl, atamaId }: { apiUrl: string; atamaId: string }) {
  const { calistir, bekliyor } = useEylem(apiUrl);
  return (
    <button
      type="button"
      onClick={() => calistir(`/flag-assignments/${atamaId}/remove`)}
      disabled={bekliyor}
      className="text-fg-muted transition-colors hover:text-danger disabled:opacity-40"
      aria-label="Etiketi kaldır"
    >
      ×
    </button>
  );
}
