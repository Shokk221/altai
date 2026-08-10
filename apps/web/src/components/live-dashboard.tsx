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
    <main className="mx-auto flex h-full w-full max-w-[110rem] flex-col gap-3 px-5 py-4">
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
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
          <span key={s.serverSlug} className="text-xs text-fg-muted last:mr-auto">
            <span className="font-semibold text-fg">{s.serverSlug}</span>
            {s.layer ? ` · ${s.layer}` : ''} · {s.playerCount}
          </span>
        ))}
        {/* Bölüm bağlantıları üst çubukta; burada tekrarlamıyoruz. */}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1.25fr_1fr]">
        {/* ------------------------------------------------ oyuncu tablosu */}
        <section className="flex min-h-0 flex-col rounded border border-border bg-surface">
          <div className="shrink-0 px-4 pt-3.5 pb-2">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Sunucudakiler</h2>
              <span className="num text-xs text-fg-faint">{gosterilenOyuncular.length}</span>
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
                <thead className="sticky top-0 bg-surface text-left text-[10.5px] font-semibold uppercase tracking-wider text-fg-faint">
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
                            <span className="ml-1.5 text-[10px] font-semibold text-accent">SL</span>
                          ) : null}
                          <span className="block truncate font-mono text-[10.5px] text-fg-faint">
                            {p.steamId}
                          </span>
                        </Link>
                      </td>
                      <td className="num py-1 pr-2">
                        <span
                          className={cn(
                            'font-semibold',
                            // Takım renkleri oyundaki karşılığıyla eşleşiyor
                            // ve her ekranda aynı kalıyor.
                            p.teamId === 1
                              ? 'text-team1'
                              : p.teamId === 2
                                ? 'text-team2'
                                : 'text-fg-faint',
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
                      <td className="num py-1 text-right text-[11px] text-fg-faint">
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
        <section className="flex min-h-0 flex-col rounded border border-border bg-surface">
          <div className="shrink-0 px-4 pt-3.5 pb-2">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Akış</h2>
              <span className="num text-xs text-fg-faint">{olaylar.length}</span>
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
              <ul className="flex flex-col">
                {gosterilenOlaylar.map((o) => (
                  <li
                    key={o.id}
                    // Izgara ŞART: satır tek parça metin olduğunda uzun mesaj
                    // sarınca zamanın altına kayıyor ve göz hizayı kaybediyor.
                    // Sabit zaman sütunu + içerik sütunu asılı girinti veriyor.
                    className={cn(
                      'grid grid-cols-[2.6rem_1fr] gap-x-2 rounded-sm px-1.5 py-[3px]',
                      'hover:bg-surface-2',
                      // Sistem olayları sohbetle yarışmamalı: sohbet okunmak
                      // için, giriş/çıkış göz ucuyla taranmak için.
                      o.tur === 'chat' ? 'text-[13px]' : 'text-[12px]',
                    )}
                  >
                    <span className="num pt-px text-right text-[11px] text-fg-faint">
                      {saat(o.timestamp)}
                    </span>
                    <span className="min-w-0 leading-[1.45]">
                      <OlaySatiri olay={o} />
                    </span>
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

/**
 * Tek olay satırı.
 *
 * Sohbette İSİM renkli ve dolgun, MESAJ normal: sohbet istemcilerinin
 * evrensel kalıbı ve okurken gözün kime ait olduğunu aramasını engelliyor.
 * Önceki sürümde mesaj sönük griydi — asıl okunacak şey en zayıf renkteydi.
 *
 * Kanal, metin etiketi yerine renkli NOKTA ile gösteriliyor: uzun bir
 * listede her satırın başındaki büyük harfli "GENEL/TAKIM/MANGA" bloğu
 * gürültü yapıyordu; renk zaten ayırt ediyor, sözcük yer kaplıyor.
 * Nokta `title` taşıyor, üstüne gelince kanal adı çıkıyor.
 */
function OlaySatiri({ olay }: { olay: CanliOlay }) {
  const isimMetni = olay.name ?? olay.steamId ?? '(bilinmiyor)';

  if (olay.tur === 'chat') {
    const renk = KANAL_RENK[olay.channel ?? ''] ?? 'text-fg-muted';
    return (
      <>
        <span
          className={cn('mr-1.5 align-[0.09em] text-[9px]', renk)}
          title={KANAL_ETIKET[olay.channel ?? ''] ?? olay.channel}
          aria-hidden
        >
          ●
        </span>
        {olay.steamId ? (
          <Link
            href={`/oyuncular?q=${olay.steamId}`}
            className={cn('font-semibold hover:underline', renk)}
          >
            {isimMetni}
          </Link>
        ) : (
          <span className={cn('font-semibold', renk)}>{isimMetni}</span>
        )}
        <span className="ml-1.5 break-words">{olay.message}</span>
      </>
    );
  }

  // Sistem olayları: tek renk, ismi vurgulu ama satırın tamamı sönük.
  const isim = olay.steamId ? (
    <Link href={`/oyuncular?q=${olay.steamId}`} className="font-medium hover:text-fg">
      {isimMetni}
    </Link>
  ) : (
    <span className="font-medium">{isimMetni}</span>
  );

  const aciklama =
    olay.tur === 'join'
      ? 'girdi'
      : olay.tur === 'leave'
        ? 'çıktı'
        : `manga ${olay.squadId} kurdu${olay.squadName ? ` · ${olay.squadName}` : ''}`;

  return (
    <span className="text-fg-faint">
      {isim} {aciklama}
    </span>
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
        'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
        etkin ? 'bg-accent-weak text-accent-2' : 'text-fg-muted hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  );
}
