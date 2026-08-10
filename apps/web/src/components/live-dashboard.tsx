'use client';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Ana ekran: o an sunucuda kim var, ne oluyor.
 *
 * Düzen BattleMetrics'in kontrol panelinden alındı çünkü moderasyon o
 * düzene alışkın: solda oyuncu tablosu (kimlik, takım, manga, rol), sağda
 * tek zaman çizgisinde olay akışı (giriş, çıkış, manga, sohbet).
 *
 * Tek WebSocket besliyor; hem sunucu durumu hem olaylar aynı bağlantıdan
 * geliyor, yoklama yok.
 */

interface LivePlayer {
  steamId: string;
  eosId: string | null;
  name: string;
  joinedAt: string;
  teamId: number | null;
  squadId: number | null;
  squadName: string | null;
  role: string | null;
  isLeader: boolean;
}

interface LiveServerState {
  serverSlug: string;
  playerCount: number;
  queueCount: number;
  layer?: string;
  players: LivePlayer[];
  updatedAt: string;
}

interface CanliOlay {
  id: string;
  tur: 'join' | 'leave' | 'squad' | 'chat';
  serverSlug: string;
  name: string | null;
  steamId: string | null;
  channel?: string;
  message?: string;
  squadId?: string;
  squadName?: string;
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

const OLAY_TAVANI = 600;

function saat(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '--:--'
    : d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

/** "2 sa 14 dk" — oyuncunun ne kadardır sunucuda olduğu. */
function suredir(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const dk = Math.floor(ms / 60000);
  if (dk < 60) return `${dk} dk`;
  return `${Math.floor(dk / 60)} sa ${dk % 60} dk`;
}

/** WPMC_Rifleman_01 -> Rifleman. Ham rol adı tabloyu okunmaz yapıyor. */
function rolKisalt(role: string | null): string {
  if (!role) return '—';
  const parcalar = role.split('_');
  return parcalar.length > 1 ? (parcalar[1] ?? role) : role;
}

export function LiveDashboard({ wsUrl }: { wsUrl: string }) {
  const [sunucular, setSunucular] = useState<Record<string, LiveServerState>>({});
  const [olaylar, setOlaylar] = useState<CanliOlay[]>([]);
  const [bagli, setBagli] = useState(false);
  const [oyuncuArama, setOyuncuArama] = useState('');
  const [olaySuzgeci, setOlaySuzgeci] = useState<CanliOlay['tur'] | null>(null);

  const akisKutusu = useRef<HTMLDivElement | null>(null);
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
        // Kopukluk fark edilmezse eski veriye bakılır; sessizce ölmesin.
        if (!kapandi) yenidenDene = setTimeout(bagla, 3000);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as
          | { type: 'snapshot'; servers: LiveServerState[] }
          | { type: 'update'; serverSlug: string; state: LiveServerState }
          | { type: 'feed_snapshot'; events: CanliOlay[] }
          | { type: 'feed'; event: CanliOlay };

        if (msg.type === 'snapshot') {
          const m: Record<string, LiveServerState> = {};
          for (const s of msg.servers) m[s.serverSlug] = s;
          setSunucular(m);
        } else if (msg.type === 'update') {
          setSunucular((o) => ({ ...o, [msg.serverSlug]: msg.state }));
        } else if (msg.type === 'feed_snapshot') {
          setOlaylar(msg.events);
        } else if (msg.type === 'feed') {
          setOlaylar((o) => {
            const y = [...o, msg.event];
            return y.length > OLAY_TAVANI ? y.slice(-OLAY_TAVANI) : y;
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

  // Otomatik kaydırma YALNIZCA en alttayken: biri yukarı kaydırıp eski bir
  // satırı okurken listeyi zorla aşağı çekmek en sinir bozucu davranış.
  useEffect(() => {
    if (!altta.current) return;
    const el = akisKutusu.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [olaylar]);

  const sunucuListesi = useMemo(
    () => Object.values(sunucular).sort((a, b) => a.serverSlug.localeCompare(b.serverSlug)),
    [sunucular],
  );

  const tumOyuncular = useMemo(
    () => sunucuListesi.flatMap((s) => s.players.map((p) => ({ ...p, serverSlug: s.serverSlug }))),
    [sunucuListesi],
  );

  const aranan = oyuncuArama.trim().toLocaleLowerCase('tr');
  const gosterilenOyuncular = useMemo(() => {
    const liste = aranan
      ? tumOyuncular.filter(
          (p) =>
            p.name.toLocaleLowerCase('tr').includes(aranan) ||
            p.steamId.includes(aranan) ||
            (p.eosId ?? '').includes(aranan) ||
            (p.squadName ?? '').toLocaleLowerCase('tr').includes(aranan),
        )
      : tumOyuncular;
    // Takım, sonra manga, sonra isim: BattleMetrics'teki gibi mangalar bir
    // arada dursun, mangasızlar sona düşsün.
    return [...liste].sort(
      (a, b) =>
        (a.teamId ?? 9) - (b.teamId ?? 9) ||
        (a.squadId ?? 999) - (b.squadId ?? 999) ||
        a.name.localeCompare(b.name, 'tr'),
    );
  }, [tumOyuncular, aranan]);

  const olaySayilari = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of olaylar) m.set(o.tur, (m.get(o.tur) ?? 0) + 1);
    return m;
  }, [olaylar]);

  const gosterilenOlaylar = olaySuzgeci ? olaylar.filter((o) => o.tur === olaySuzgeci) : olaylar;

  const toplamOyuncu = sunucuListesi.reduce((a, s) => a + s.playerCount, 0);
  const toplamKuyruk = sunucuListesi.reduce((a, s) => a + s.queueCount, 0);

  return (
    <main className="mx-auto flex h-screen w-full max-w-[110rem] flex-col gap-3 px-5 py-4">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="display text-2xl">Altai</h1>
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
          {bagli ? 'canlı' : 'bağlantı yok'}
        </span>
        <span className="display text-lg">
          {toplamOyuncu}
          {toplamKuyruk > 0 ? (
            <span className="ml-1 text-xs font-semibold text-fg-muted">+{toplamKuyruk} kuyruk</span>
          ) : null}
        </span>
        {sunucuListesi.map((s) => (
          <span key={s.serverSlug} className="text-xs text-fg-muted">
            <span className="font-semibold text-fg">{s.serverSlug}</span>
            {s.layer ? ` · ${s.layer}` : ''} · {s.playerCount}
          </span>
        ))}
        <nav className="ml-auto flex gap-4 text-xs font-semibold text-fg-muted">
          <Link href="/oyuncular" className="hover:text-fg">
            Oyuncular
          </Link>
          <Link href="/yetkiler" className="hover:text-fg">
            Yetkiler
          </Link>
        </nav>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1.25fr_1fr]">
        {/* ------------------------------------------------ oyuncu tablosu */}
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
              placeholder="İsim, SteamID, EOS ya da manga…"
              className="min-h-9 px-3.5 text-[13px]"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {gosterilenOyuncular.length === 0 ? (
              <p className="py-8 text-center text-xs text-fg-muted">
                {tumOyuncular.length === 0 ? 'Sunucuda kimse yok' : 'Eşleşen oyuncu yok'}
              </p>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 bg-surface text-left text-[10px] uppercase tracking-wide text-fg-muted">
                  <tr>
                    <th className="pb-1.5 font-bold">Oyuncu</th>
                    <th className="pb-1.5 font-bold">Tk</th>
                    <th className="pb-1.5 font-bold">Mg</th>
                    <th className="pb-1.5 font-bold">Rol</th>
                    <th className="pb-1.5 text-right font-bold">Süre</th>
                  </tr>
                </thead>
                <tbody>
                  {gosterilenOyuncular.map((p) => (
                    <tr key={`${p.serverSlug}:${p.steamId}`} className="hover:bg-surface-2">
                      <td className="max-w-0 py-1 pr-2">
                        <Link href={`/oyuncular?q=${p.steamId}`} className="block truncate">
                          <span className="font-medium">{p.name}</span>
                          {p.isLeader ? (
                            <span className="ml-1.5 text-[10px] font-bold text-accent">SL</span>
                          ) : null}
                          <span className="block truncate font-mono text-[10px] text-fg-muted">
                            {p.steamId}
                          </span>
                        </Link>
                      </td>
                      <td className="py-1 pr-2 tabular-nums">
                        <span
                          className={cn(
                            'font-semibold',
                            p.teamId === 1
                              ? 'text-info'
                              : p.teamId === 2
                                ? 'text-success'
                                : 'text-fg-muted',
                          )}
                        >
                          {p.teamId ?? '—'}
                        </span>
                      </td>
                      <td className="max-w-[7rem] truncate py-1 pr-2 text-fg-muted">
                        {p.squadId ? (p.squadName ?? p.squadId) : '—'}
                      </td>
                      <td className="max-w-[6rem] truncate py-1 pr-2 text-fg-muted">
                        {rolKisalt(p.role)}
                      </td>
                      <td className="py-1 text-right tabular-nums text-[11px] text-fg-muted">
                        {suredir(p.joinedAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* ------------------------------------------------------ olay akışı */}
        <section className="flex min-h-0 flex-col rounded bg-surface">
          <div className="shrink-0 px-4 pt-3.5 pb-2">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Akış</h2>
              <span className="text-xs tabular-nums text-fg-muted">{olaylar.length}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              <Cip etkin={olaySuzgeci === null} onClick={() => setOlaySuzgeci(null)}>
                hepsi {olaylar.length}
              </Cip>
              {(['chat', 'join', 'leave', 'squad'] as const)
                .filter((t) => olaySayilari.has(t))
                .map((t) => (
                  <Cip
                    key={t}
                    etkin={olaySuzgeci === t}
                    onClick={() => setOlaySuzgeci(olaySuzgeci === t ? null : t)}
                  >
                    {{ chat: 'sohbet', join: 'giriş', leave: 'çıkış', squad: 'manga' }[t]}{' '}
                    {olaySayilari.get(t)}
                  </Cip>
                ))}
            </div>
          </div>

          <div
            ref={akisKutusu}
            onScroll={(e) => {
              const el = e.currentTarget;
              altta.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"
          >
            {gosterilenOlaylar.length === 0 ? (
              <p className="py-8 text-center text-xs text-fg-muted">Henüz olay yok</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {gosterilenOlaylar.map((o) => (
                  <li key={o.id} className="text-[13px] leading-snug">
                    <span className="mr-1.5 tabular-nums text-[11px] text-fg-muted">
                      {saat(o.timestamp)}
                    </span>
                    <OlaySatiri olay={o} />
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

function OlaySatiri({ olay }: { olay: CanliOlay }) {
  const isim = olay.steamId ? (
    <Link href={`/oyuncular?q=${olay.steamId}`} className="font-semibold hover:text-accent">
      {olay.name ?? olay.steamId}
    </Link>
  ) : (
    <span className="font-semibold">{olay.name ?? '(bilinmiyor)'}</span>
  );

  if (olay.tur === 'chat') {
    return (
      <>
        <span
          className={cn(
            'mr-1.5 text-[10px] font-bold tracking-wide',
            KANAL_RENK[olay.channel ?? ''] ?? 'text-fg-muted',
          )}
        >
          {KANAL_ETIKET[olay.channel ?? ''] ?? olay.channel}
        </span>
        {isim}
        <span className="ml-1 break-words text-fg-muted">{olay.message}</span>
      </>
    );
  }
  if (olay.tur === 'join') {
    return (
      <>
        {isim} <span className="text-success">sunucuya girdi</span>
      </>
    );
  }
  if (olay.tur === 'leave') {
    return (
      <>
        {isim} <span className="text-fg-muted">sunucudan çıktı</span>
      </>
    );
  }
  return (
    <>
      {isim}{' '}
      <span className="text-fg-muted">
        manga {olay.squadId} kurdu
        {olay.squadName ? ` (${olay.squadName})` : ''}
      </span>
    </>
  );
}

function Cip({
  etkin,
  onClick,
  children,
}: {
  etkin: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide transition-colors',
        etkin ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  );
}
