'use client';

import { Badge } from '@/components/ui/badge';
import { EmptyState, Skeleton } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { gecenSure, tarih } from '@/lib/format';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

interface Result {
  id: string;
  steamId: string | null;
  eosId: string | null;
  name: string;
  matchedName: string | null;
  /** Güncel isim hariç, en son kullanılan diğer isimler — tarihleriyle. */
  eskiIsimler: { name: string; lastSeen: string | null }[];
  knownNames: number;
  /** İsim geçmişinin en yeni damgası. */
  sonGorulme: string | null;
  flags: string[];
  hasActiveBan: boolean;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; results: Result[]; query: string };

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

export function PlayerSearch({ apiUrl, ilkSorgu = '' }: { apiUrl: string; ilkSorgu?: string }) {
  const [query, setQuery] = useState(ilkSorgu);
  const [state, setState] = useState<State>({ kind: 'idle' });
  // Yavaş bir isteğin, sonradan yazılan aramanın sonucunu ezmesini engeller.
  const requestId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setState({ kind: 'idle' });
      return;
    }

    const id = ++requestId.current;
    // Her tuşta istek atmıyoruz: 857 bin isim üzerinde arama ucuz değil.
    const timer = setTimeout(async () => {
      setState({ kind: 'loading' });
      try {
        const res = await fetch(`${apiUrl}/players/search?q=${encodeURIComponent(q)}`, {
          credentials: 'include',
        });
        if (id !== requestId.current) return;
        if (res.status === 401) {
          setState({ kind: 'error', message: 'Oturum düşmüş. Tekrar giriş yapın.' });
          return;
        }
        if (!res.ok) {
          setState({ kind: 'error', message: 'Arama başarısız oldu.' });
          return;
        }
        const data = (await res.json()) as { results: Result[]; query: string };
        if (id !== requestId.current) return;
        setState({ kind: 'done', results: data.results, query: data.query });
      } catch {
        if (id === requestId.current) {
          setState({ kind: 'error', message: 'Sunucuya ulaşılamadı.' });
        }
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, apiUrl]);

  const hint = useMemo(() => {
    const q = query.trim();
    if (q.length === 0) return 'İsim, SteamID veya EOS ID ile arayın.';
    if (q.length < MIN_QUERY) return `En az ${MIN_QUERY} karakter yazın.`;
    return null;
  }, [query]);

  return (
    <div className="space-y-5">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Oyuncu ara — isim, SteamID veya EOS ID"
        autoComplete="off"
        spellCheck={false}
        aria-label="Oyuncu ara"
      />

      {hint ? <p className="text-sm text-fg-muted">{hint}</p> : null}

      {state.kind === 'loading' ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[74px] w-full" />
          ))}
        </div>
      ) : null}

      {state.kind === 'error' ? <EmptyState title={state.message} tone="danger" /> : null}

      {state.kind === 'done' && state.results.length === 0 ? (
        <EmptyState
          title="Eşleşen oyuncu yok"
          hint="Farklı bir yazım deneyin — arama isim geçmişini de kapsıyor."
        />
      ) : null}

      {state.kind === 'done' && state.results.length > 0 ? (
        // Sıkışık tablo DEĞİL: her sonuç kendi dolgulu satır bloğu.
        // Başlık satırı yok — sütunsuz düzende anlamı kalmıyor ve
        // elektronik tablo hissini o veriyordu.
        <ul className="flex flex-col gap-2">
          {state.results.map((r) => (
            <PlayerRow key={r.id} result={r} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Tek sonuç satırı.
 *
 * Ferah ve dolgulu: önceki hâli 13 piksellik hücrelerden oluşan sıkışık bir
 * tabloydu ve elektronik tablo gibi duruyordu. Bilgi aynı, nefes alanı
 * farklı — moderasyon listesi taranıyor ama satırlar birbirine yapışınca
 * göz hangi satırda olduğunu kaybediyor.
 */
function PlayerRow({ result }: { result: Result }) {
  return (
    <li>
      <Link
        href={`/oyuncular/${result.id}`}
        className="flex items-start justify-between gap-4 rounded border border-border bg-surface px-4 py-3 transition-colors hover:border-border-strong hover:bg-surface-2"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-[15px] font-semibold">{result.name}</span>
            {result.hasActiveBan ? <Badge tone="danger">banlı</Badge> : null}
            {result.flags.slice(0, 4).map((f) => (
              <Badge key={f} tone="info">
                {f}
              </Badge>
            ))}
            {result.flags.length > 4 ? (
              <span className="text-[11px] text-fg-faint">+{result.flags.length - 4}</span>
            ) : null}
          </span>

          <span className="mt-1.5 block truncate font-mono text-[11.5px] text-fg-faint">
            {result.steamId ?? 'Steam yok'} · {result.eosId ?? 'EOS yok'}
          </span>

          {/* Aranan isim güncelden farklıysa göstermek şart: admin bu
              sonucun neden çıktığını anlamalı. */}
          {result.matchedName && result.matchedName !== result.name ? (
            <span className="mt-1 block truncate text-[12.5px] text-fg-muted">
              eşleşen: <span className="font-medium text-fg">{result.matchedName}</span>
            </span>
          ) : null}

          {/* Eski nickler ALT ALTA, her biri kendi tarihiyle. Tek satırda
              nokta ile birleştirilince hem taşıyor hem "hangi isim ne zaman"
              bilgisi kayboluyordu. */}
          {result.eskiIsimler.length > 0 ? (
            <span className="mt-2 block border-t border-border pt-2">
              {result.eskiIsimler.map((n) => (
                <span
                  key={n.name}
                  className="flex items-baseline justify-between gap-3 py-[3px] text-[12.5px]"
                >
                  <span className="truncate text-fg-muted">{n.name}</span>
                  <span className="num shrink-0 text-[11px] text-fg-faint">
                    {tarih(n.lastSeen)}
                    <span className="ml-1.5">{gecenSure(n.lastSeen)}</span>
                  </span>
                </span>
              ))}
              {result.knownNames > result.eskiIsimler.length + 1 ? (
                <span className="mt-0.5 block text-[11px] text-fg-faint">
                  +{result.knownNames - result.eskiIsimler.length - 1} isim daha
                </span>
              ) : null}
            </span>
          ) : null}
        </span>

        <span className="shrink-0 text-right">
          <span className="num block text-[12.5px] text-fg-muted">{tarih(result.sonGorulme)}</span>
          {/* Mutlak tarih hangi gün olduğunu, göreli ne kadar eski olduğunu
              söylüyor; ikisi de gerekiyor. */}
          <span className="block text-[11px] text-fg-faint">{gecenSure(result.sonGorulme)}</span>
        </span>
      </Link>
    </li>
  );
}
