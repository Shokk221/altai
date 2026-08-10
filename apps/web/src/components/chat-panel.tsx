'use client';

import { cn } from '@/lib/cn';
import { saatDakika } from '@/lib/format';
import { useMemo, useState } from 'react';

/**
 * Sohbet paneli.
 *
 * Kanal HER SATIRDA görünüyor. İlk sürümde `All` etiketi gizleniyordu
 * (gürültü azaltmak için) ama moderasyonda mesajın nerede yazıldığı
 * içeriği kadar önemli: takım sohbetindeki bir küfürle genel sohbetteki
 * aynı küfür farklı ağırlıkta. Etiketsiz satır "genel" mi yoksa "bilinmiyor"
 * mu belirsizdi.
 *
 * Renkler kanalı okumadan ayırt etmek için: uzun bir listede etiket metnini
 * tek tek okumak yerine renk taranıyor.
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
  All: 'text-fg-muted',
  Team: 'text-info',
  Squad: 'text-success',
  Admin: 'text-accent',
};

const KANAL_ETIKET: Record<string, string> = {
  All: 'GENEL',
  Team: 'TAKIM',
  Squad: 'MANGA',
  Admin: 'ADMIN',
};

export function ChatPanel({ mesajlar }: { mesajlar: Mesaj[] }) {
  const [secili, setSecili] = useState<Kanal | null>(null);

  const sayilar = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of mesajlar) {
      const k = x.channel ?? '?';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [mesajlar]);

  const gosterilen = secili ? mesajlar.filter((m) => m.channel === secili) : mesajlar;

  if (mesajlar.length === 0) {
    return <p className="py-6 text-center text-xs text-fg-muted">Kayıtlı mesaj yok</p>;
  }

  return (
    <div className="flex min-h-0 flex-col">
      {/* Süzgeç sticky: uzun listede kaydırırken kaybolmasın. */}
      <div className="sticky top-0 z-10 -mx-4 mb-2 flex flex-wrap gap-1 bg-surface px-4 pb-2">
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

      {gosterilen.length === 0 ? (
        <p className="py-6 text-center text-xs text-fg-muted">Bu kanalda mesaj yok</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {gosterilen.map((m) => (
            <li key={m.id} className="text-[13px] leading-snug">
              <span className="mr-1.5 text-[11px] tabular-nums text-fg-muted">
                {saatDakika(m.sentAt)}
              </span>
              <span
                className={cn(
                  'mr-1.5 text-[10px] font-bold tracking-wide',
                  KANAL_RENK[m.channel ?? ''] ?? 'text-fg-muted',
                )}
              >
                {KANAL_ETIKET[m.channel ?? ''] ?? (m.channel ?? '?').toUpperCase()}
              </span>
              <span className="break-words">{m.message}</span>
            </li>
          ))}
        </ul>
      )}
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
        'rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors',
        etkin ? 'bg-surface-2 text-fg' : cn('hover:bg-surface-2', renk ?? 'text-fg-muted'),
      )}
    >
      {children}
    </button>
  );
}
