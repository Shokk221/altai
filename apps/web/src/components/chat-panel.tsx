'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import { saatDakika } from '@/lib/format';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Sohbet paneli.
 *
 * Kanal HER SATIRDA görünüyor. İlk sürümde `All` etiketi gizleniyordu
 * (gürültü azaltmak için) ama moderasyonda mesajın nerede yazıldığı içeriği
 * kadar önemli: manga sohbetindeki bir söz ile genel sohbetteki aynı söz
 * farklı ağırlıkta. Renkler kanalı okumadan ayırt etmek için — uzun listede
 * etiket metnini tek tek okumak yerine renk taranıyor.
 *
 * Profil ilk 200 mesajı sunucudan hazır getiriyor. Devamı ve arama
 * sunucudan sayfalı geliyor: en çok konuşanda 3.901 mesaj var ve hepsini
 * her profil açılışında taşımak anlamsız.
 */

export interface Mesaj {
  id: string;
  channel: string | null;
  message: string;
  sentAt: string;
}

const KANALLAR = ['All', 'Team', 'Squad', 'Admin'] as const;
type Kanal = (typeof KANALLAR)[number];

const KANAL_RENK: Record<string, string> = {
  All: 'text-fg-faint',
  Team: 'text-team2',
  Squad: 'text-success',
  Admin: 'text-accent',
};

const KANAL_ETIKET: Record<string, string> = {
  All: 'GENEL',
  Team: 'TAKIM',
  Squad: 'MANGA',
  Admin: 'ADMIN',
};

const ARAMA_GECIKMESI_MS = 300;
const MIN_ARAMA = 2;

export function ChatPanel({
  apiUrl,
  playerId,
  ilkMesajlar,
}: {
  apiUrl: string;
  playerId: string;
  ilkMesajlar: Mesaj[];
}) {
  const [mesajlar, setMesajlar] = useState<Mesaj[]>(ilkMesajlar);
  const [secili, setSecili] = useState<Kanal | null>(null);
  const [arama, setArama] = useState('');
  const [yukleniyor, setYukleniyor] = useState(false);
  const [devam, setDevam] = useState(ilkMesajlar.length >= 200);
  const [hata, setHata] = useState<string | null>(null);
  // Yavaş bir aramanın, sonradan yazılanın sonucunu ezmesini engeller.
  const istekId = useRef(0);

  // Arama sunucuda: 3.901 mesajın tamamı istemcide olmadığı için yerel
  // filtreleme yanlış sonuç verirdi ("yok" der ama sunucuda vardır).
  useEffect(() => {
    const q = arama.trim();
    const id = ++istekId.current;

    const zamanlayici = setTimeout(async () => {
      if (q.length > 0 && q.length < MIN_ARAMA) return;
      setYukleniyor(true);
      setHata(null);
      try {
        const url = new URL(`${apiUrl}/players/${playerId}/chat`);
        if (q.length >= MIN_ARAMA) url.searchParams.set('q', q);
        const res = await fetch(url, { credentials: 'include' });
        if (id !== istekId.current) return;
        if (!res.ok) {
          setHata('Sohbet getirilemedi');
          return;
        }
        const veri = (await res.json()) as { mesajlar: Mesaj[]; devam: boolean };
        setMesajlar(veri.mesajlar);
        setDevam(veri.devam);
      } catch {
        if (id === istekId.current) setHata('Sunucuya ulaşılamadı');
      } finally {
        if (id === istekId.current) setYukleniyor(false);
      }
    }, ARAMA_GECIKMESI_MS);

    return () => clearTimeout(zamanlayici);
  }, [arama, apiUrl, playerId]);

  async function dahaEski() {
    const sonuncu = mesajlar[mesajlar.length - 1];
    if (!sonuncu) return;
    setYukleniyor(true);
    try {
      const url = new URL(`${apiUrl}/players/${playerId}/chat`);
      url.searchParams.set('before', sonuncu.sentAt);
      const q = arama.trim();
      if (q.length >= MIN_ARAMA) url.searchParams.set('q', q);
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        setHata('Devamı getirilemedi');
        return;
      }
      const veri = (await res.json()) as { mesajlar: Mesaj[]; devam: boolean };
      setMesajlar((onceki) => [...onceki, ...veri.mesajlar]);
      setDevam(veri.devam);
    } catch {
      setHata('Sunucuya ulaşılamadı');
    } finally {
      setYukleniyor(false);
    }
  }

  const sayilar = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of mesajlar) {
      const k = x.channel ?? '?';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [mesajlar]);

  // Kanal süzgeci YEREL: yüklenmiş mesajlar üzerinde çalışıyor ve sayısı
  // çipte yazıyor, yani neyin içinden süzdüğü belli.
  const gosterilen = secili ? mesajlar.filter((m) => m.channel === secili) : mesajlar;

  return (
    <div className="flex min-h-0 flex-col">
      <div className="sticky top-0 z-10 -mx-4 mb-2 flex flex-col gap-2 bg-surface px-4 pb-2">
        <Input
          value={arama}
          onChange={(e) => setArama(e.target.value)}
          placeholder="Mesajlarda ara…"
          className="min-h-9 px-3.5 text-[13px]"
        />
        <div className="flex flex-wrap gap-1">
          <Cip etkin={secili === null} onClick={() => setSecili(null)}>
            hepsi {mesajlar.length}
          </Cip>
          {KANALLAR.filter((k) => sayilar.has(k)).map((k) => (
            <Cip
              key={k}
              etkin={secili === k}
              renk={KANAL_RENK[k]}
              onClick={() => setSecili(secili === k ? null : k)}
            >
              {KANAL_ETIKET[k]} {sayilar.get(k)}
            </Cip>
          ))}
        </div>
      </div>

      {hata ? <p className="py-2 text-xs font-medium text-danger">{hata}</p> : null}

      {gosterilen.length === 0 ? (
        <p className="py-6 text-center text-xs text-fg-muted">
          {yukleniyor ? 'Yükleniyor…' : arama.trim() ? 'Eşleşen mesaj yok' : 'Kayıtlı mesaj yok'}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {gosterilen.map((m) => (
            <li
              key={m.id}
              // Canlı akışla aynı ızgara: uzun mesaj sarınca zamanın altına
              // kaymasın, içerik sütununda hizalı kalsın.
              className="grid grid-cols-[4.2rem_1fr] gap-x-2 px-1.5 text-[13px] hover:bg-surface-2"
            >
              <span className="num pt-[7px] text-right text-[11px] text-fg-faint">
                {saatDakika(m.sentAt)}
              </span>
              {/* Çizgi zaman sütunundan SONRA başlıyor (iOS tablo kalıbı):
                  tam genişlikte olsaydı dar panelde okumayı bölerdi. */}
              <span className="min-w-0 border-b border-border py-[6px] leading-[1.45]">
                {/* Kanal renkli nokta; renk zaten ayırt ediyor, büyük harfli
                    etiket yer kaplıyordu. Üstüne gelince adı çıkıyor. */}
                <span
                  className={cn(
                    'mr-1.5 align-[0.09em] text-[9px]',
                    KANAL_RENK[m.channel ?? ''] ?? 'text-fg-muted',
                  )}
                  title={KANAL_ETIKET[m.channel ?? ''] ?? m.channel ?? ''}
                  aria-hidden
                >
                  ●
                </span>
                <span className="break-words">{m.message}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {devam ? (
        <button
          type="button"
          onClick={dahaEski}
          disabled={yukleniyor}
          className="mt-3 w-full rounded-full bg-surface-2 py-2 text-xs font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
        >
          {yukleniyor ? 'Yükleniyor…' : 'Daha eski mesajlar'}
        </button>
      ) : null}
    </div>
  );
}

function Cip({
  etkin,
  renk,
  onClick,
  children,
}: {
  etkin: boolean;
  renk?: string | undefined;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
        etkin ? 'bg-accent-weak text-accent-2' : cn('hover:bg-surface-2', renk ?? 'text-fg-muted'),
      )}
    >
      {children}
    </button>
  );
}
