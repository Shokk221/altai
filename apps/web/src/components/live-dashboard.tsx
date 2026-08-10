'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Canlı ekran: o an sunucuda kim var, ne konuşuluyor.
 *
 * Tek WebSocket üzerinden besleniyor — hem sunucu durumu hem sohbet aynı
 * bağlantıdan geliyor, ayrı ayrı yoklama (polling) yok.
 *
 * Sohbet otomatik kayıyor ama YALNIZCA kullanıcı en alttaysa. Biri yukarı
 * kaydırıp eski bir mesajı okurken listeyi zorla aşağı çekmek, canlı
 * ekranların en sinir bozucu davranışı.
 */

interface LivePlayer {
  steamId: string;
  name: string;
  joinedAt: string;
}

interface LiveServerState {
  serverSlug: string;
  playerCount: number;
  queueCount: number;
  layer?: string;
  players: LivePlayer[];
  updatedAt: string;
}

interface CanliMesaj {
  serverSlug: string;
  steamId: string;
  name: string | null;
  channel: string;
  message: string;
  timestamp: string;
}

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

const MESAJ_TAVANI = 500;

function saat(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '--:--'
    : d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function LiveDashboard({ wsUrl }: { wsUrl: string }) {
  const [sunucular, setSunucular] = useState<Record<string, LiveServerState>>({});
  const [mesajlar, setMesajlar] = useState<CanliMesaj[]>([]);
  const [bagli, setBagli] = useState(false);
  const [oyuncuArama, setOyuncuArama] = useState('');
  const [kanal, setKanal] = useState<string | null>(null);

  const sohbetKutusu = useRef<HTMLDivElement | null>(null);
  const altta = useRef(true);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let kapandi = false;
    let yenidenDene: ReturnType<typeof setTimeout> | undefined;

    function bagla() {
      ws = new WebSocket(wsUrl);

      ws.onopen = () => setBagli(true);
      ws.onclose = () => {
        setBagli(false);
        // Bağlantı kopunca sessizce ölmesin: canlı ekran açık bırakılıyor
        // ve kopukluk fark edilmezse eski veriye bakılır.
        if (!kapandi) yenidenDene = setTimeout(bagla, 3000);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as
          | { type: 'snapshot'; servers: LiveServerState[] }
          | { type: 'update'; serverSlug: string; state: LiveServerState }
          | { type: 'chat_snapshot'; messages: CanliMesaj[] }
          | { type: 'chat'; message: CanliMesaj };

        if (msg.type === 'snapshot') {
          const m: Record<string, LiveServerState> = {};
          for (const s of msg.servers) m[s.serverSlug] = s;
          setSunucular(m);
        } else if (msg.type === 'update') {
          setSunucular((o) => ({ ...o, [msg.serverSlug]: msg.state }));
        } else if (msg.type === 'chat_snapshot') {
          setMesajlar(msg.messages);
        } else if (msg.type === 'chat') {
          setMesajlar((o) => {
            const y = [...o, msg.message];
            return y.length > MESAJ_TAVANI ? y.slice(-MESAJ_TAVANI) : y;
          });
        }
      };
    }

    bagla();
    return () => {
      kapandi = true;
      if (yenidenDene) clearTimeout(yenidenDene);
      ws?.close();
    };
  }, [wsUrl]);

  // Kullanıcı en alttaysa yeni mesajla birlikte kaydır.
  useEffect(() => {
    if (!altta.current) return;
    const el = sohbetKutusu.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [mesajlar]);

  const sunucuListesi = Object.values(sunucular).sort((a, b) =>
    a.serverSlug.localeCompare(b.serverSlug),
  );

  const tumOyuncular = useMemo(
    () => sunucuListesi.flatMap((s) => s.players.map((p) => ({ ...p, serverSlug: s.serverSlug }))),
    [sunucuListesi],
  );

  const aranan = oyuncuArama.trim().toLocaleLowerCase('tr');
  const gosterilenOyuncular = aranan
    ? tumOyuncular.filter(
        (p) => p.name.toLocaleLowerCase('tr').includes(aranan) || p.steamId.includes(aranan),
      )
    : tumOyuncular;

  const kanalSayilari = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of mesajlar) m.set(x.channel, (m.get(x.channel) ?? 0) + 1);
    return m;
  }, [mesajlar]);

  const gosterilenMesajlar = kanal ? mesajlar.filter((m) => m.channel === kanal) : mesajlar;

  return (
    <main className="mx-auto flex h-screen w-full max-w-[104rem] flex-col gap-3 px-5 py-4">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="display text-2xl">Canlı</h1>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-xs font-semibold',
            bagli ? 'text-success' : 'text-danger',
          )}
        >
          <span
            className={cn('h-2 w-2 rounded-full', bagli ? 'bg-success' : 'bg-danger')}
            aria-hidden
          />
          {bagli ? 'bağlı' : 'bağlantı yok'}
        </span>
        {sunucuListesi.map((s) => (
          <span key={s.serverSlug} className="text-xs text-fg-muted">
            <span className="font-semibold text-fg">{s.serverSlug}</span> · {s.playerCount} oyuncu
            {s.queueCount > 0 ? ` · ${s.queueCount} kuyrukta` : ''}
            {s.layer ? ` · ${s.layer}` : ''}
          </span>
        ))}
        <Link
          href="/oyuncular"
          className="ml-auto text-xs font-semibold text-fg-muted hover:text-fg"
        >
          Oyuncular →
        </Link>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_1.6fr]">
        {/* --- oyuncular --- */}
        <section className="flex min-h-0 flex-col rounded bg-surface">
          <div className="shrink-0 px-4 pt-3.5 pb-2">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Sunucudakiler</h2>
              <span className="text-xs tabular-nums text-fg-muted">
                {gosterilenOyuncular.length}
              </span>
            </div>
            <Input
              value={oyuncuArama}
              onChange={(e) => setOyuncuArama(e.target.value)}
              placeholder="İsim ya da SteamID…"
              className="min-h-9 px-3.5 text-[13px]"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {gosterilenOyuncular.length === 0 ? (
              <p className="py-6 text-center text-xs text-fg-muted">
                {tumOyuncular.length === 0 ? 'Sunucuda kimse yok' : 'Eşleşen oyuncu yok'}
              </p>
            ) : (
              <ul className="flex flex-col">
                {gosterilenOyuncular.map((p) => (
                  <li key={`${p.serverSlug}:${p.steamId}`}>
                    {/* Profil kimliğini canlı durum taşımıyor; aramaya
                        SteamID ile gidiyoruz, orası kimliği kesin çözüyor. */}
                    <Link
                      href={`/oyuncular?q=${p.steamId}`}
                      className="flex items-baseline justify-between gap-2 rounded-sm px-1 py-1.5 text-[13px] transition-colors hover:bg-surface-2"
                    >
                      <span className="truncate">{p.name}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-fg-muted">
                        {saat(p.joinedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* --- sohbet --- */}
        <section className="flex min-h-0 flex-col rounded bg-surface">
          <div className="shrink-0 px-4 pt-3.5 pb-2">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Sohbet</h2>
              <span className="text-xs tabular-nums text-fg-muted">{mesajlar.length}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              <Cip etkin={kanal === null} onClick={() => setKanal(null)}>
                hepsi {mesajlar.length}
              </Cip>
              {['All', 'Team', 'Squad', 'Admin']
                .filter((k) => kanalSayilari.has(k))
                .map((k) => (
                  <Cip
                    key={k}
                    etkin={kanal === k}
                    renk={KANAL_RENK[k]}
                    onClick={() => setKanal(kanal === k ? null : k)}
                  >
                    {KANAL_ETIKET[k]} {kanalSayilari.get(k)}
                  </Cip>
                ))}
            </div>
          </div>
          <div
            ref={sohbetKutusu}
            onScroll={(e) => {
              const el = e.currentTarget;
              altta.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"
          >
            {gosterilenMesajlar.length === 0 ? (
              <p className="py-6 text-center text-xs text-fg-muted">Henüz mesaj yok</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {gosterilenMesajlar.map((m, i) => (
                  <li key={`${m.timestamp}:${m.steamId}:${i}`} className="text-[13px] leading-snug">
                    <span className="mr-1.5 text-[11px] tabular-nums text-fg-muted">
                      {saat(m.timestamp)}
                    </span>
                    <span
                      className={cn(
                        'mr-1.5 text-[10px] font-bold tracking-wide',
                        KANAL_RENK[m.channel] ?? 'text-fg-muted',
                      )}
                    >
                      {KANAL_ETIKET[m.channel] ?? m.channel.toUpperCase()}
                    </span>
                    <Link
                      href={`/oyuncular?q=${m.steamId}`}
                      className="mr-1 font-semibold hover:text-accent"
                    >
                      {m.name ?? m.steamId}
                    </Link>
                    <span className="break-words text-fg-muted">{m.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
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
