'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';

/**
 * Oyuncu profilindeki yazma eylemleri.
 *
 * Eylemler künye bandının içinde duruyor ve kapalıyken TEK SATIR yer
 * kaplıyor. İlk sürümde ban formu ve not formu ayrı ayrı, sürekli açık
 * bloklardı; sayfanın yarısını doldurup asıl bilgiyi ekrandan itiyorlardı.
 *
 * Her eylem hatasını kendi yanında gösteriyor: tek bir üst bölgede toplamak
 * hangi işlemin başarısız olduğunu belirsiz bırakıyordu.
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

  return { calistir, bekliyor, hata };
}

function Hata({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="mt-2 text-xs font-medium text-danger">{children}</p>;
}

type Kip = null | 'ban' | 'note' | 'warning' | 'watchlist';

const KAYIT_ETIKET: Record<'note' | 'warning' | 'watchlist', string> = {
  note: 'Not',
  warning: 'Uyarı',
  watchlist: 'Takip',
};

/**
 * Kompakt eylem çubuğu.
 *
 * Kapalıyken düğme satırı, açıkken aynı yerde tek satırlık form. Formu
 * açmak sayfanın düzenini kaydırmasın diye yükseklik farkı en aza indirildi.
 */
export function HizliEylemler({
  apiUrl,
  playerId,
  banlayabilir,
  notYazabilir,
}: {
  apiUrl: string;
  playerId: string;
  banlayabilir: boolean;
  notYazabilir: boolean;
}) {
  const { calistir, bekliyor, hata } = useEylem(apiUrl);
  const [kip, setKip] = useState<Kip>(null);
  const [metin, setMetin] = useState('');
  // Ban süresi gün olarak; boş = kalıcı. Takvim açmaktan hızlı.
  const [gun, setGun] = useState('');

  const kapat = () => {
    setKip(null);
    setMetin('');
    setGun('');
  };

  const gonder = async () => {
    if (!kip) return;
    let ok = false;
    if (kip === 'ban') {
      const g = Number(gun);
      const expiresAt =
        gun.trim() === '' ? null : new Date(Date.now() + Math.max(1, g) * 86_400_000).toISOString();
      ok = await calistir(`/players/${playerId}/bans`, { reason: metin.trim(), expiresAt });
    } else {
      ok = await calistir(`/players/${playerId}/records`, { kind: kip, body: metin.trim() });
    }
    if (ok) kapat();
  };

  if (kip === null) {
    return (
      <div className="flex flex-wrap gap-2">
        {banlayabilir ? (
          <Button variant="danger" size="sm" onClick={() => setKip('ban')}>
            Ban at
          </Button>
        ) : null}
        {notYazabilir
          ? (['note', 'warning', 'watchlist'] as const).map((k) => (
              <Button key={k} variant="soft" size="sm" onClick={() => setKip(k)}>
                {KAYIT_ETIKET[k]} ekle
              </Button>
            ))
          : null}
      </div>
    );
  }

  const banKipi = kip === 'ban';
  const yeterli = banKipi ? metin.trim().length >= 3 : metin.trim().length > 0;

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          autoFocus
          placeholder={banKipi ? 'Ban sebebi (oyuncuya gösterilir)' : `${KAYIT_ETIKET[kip]} metni`}
          value={metin}
          onChange={(e) => setMetin(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && yeterli) void gonder();
            if (e.key === 'Escape') kapat();
          }}
          className="flex-1"
        />
        {banKipi ? (
          <Input
            placeholder="Gün (boş = kalıcı)"
            inputMode="numeric"
            value={gun}
            onChange={(e) => setGun(e.target.value.replace(/\D/g, ''))}
            className="sm:w-40"
          />
        ) : null}
        <div className="flex gap-2">
          <Button
            variant={banKipi ? 'danger' : 'ink'}
            size="sm"
            onClick={gonder}
            disabled={bekliyor || !yeterli}
          >
            {bekliyor ? '…' : banKipi ? 'Banla' : 'Ekle'}
          </Button>
          <Button variant="ghost" size="sm" onClick={kapat} disabled={bekliyor}>
            Vazgeç
          </Button>
        </div>
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

export function KaydiKapat({ apiUrl, recordId }: { apiUrl: string; recordId: string }) {
  const { calistir, bekliyor, hata } = useEylem(apiUrl);
  return (
    <div>
      <button
        type="button"
        onClick={() => calistir(`/records/${recordId}/resolve`)}
        disabled={bekliyor}
        className="text-[11px] font-semibold text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
      >
        {bekliyor ? '…' : 'kapat'}
      </button>
      <Hata>{hata}</Hata>
    </div>
  );
}

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
