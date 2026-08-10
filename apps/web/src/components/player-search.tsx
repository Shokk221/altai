'use client';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { EmptyState, Skeleton } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

interface Result {
  id: string;
  steamId: string | null;
  eosId: string | null;
  name: string;
  matchedName: string | null;
  knownNames: number;
  hasActiveBan: boolean;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; results: Result[]; query: string };

const MIN_QUERY = 2;
const DEBOUNCE_MS = 250;

export function PlayerSearch({ apiUrl }: { apiUrl: string }) {
  const [query, setQuery] = useState('');
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
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[86px] w-full" />
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
        <ul className="space-y-3">
          {state.results.map((r) => (
            <PlayerRow key={r.id} result={r} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Masaüstünde satır, mobilde kart. Plan Bölüm 8: "tablolar mobilde kart
 * görünümüne düşer" — burada tek düzen ikisini de karşılıyor, çünkü
 * içerik zaten dikey akıyor.
 */
function PlayerRow({ result }: { result: Result }) {
  return (
    <li>
      {/* Tüm kart tıklanabilir: moderasyonda hedef küçük olursa mobilde
          kullanılamıyor (plan Bölüm 8 — tek elle kullanım). */}
      <Link href={`/oyuncular/${result.id}`} className="block">
        <Card className="transition-colors hover:bg-surface-2">
          <div className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <span className="truncate text-[15px] font-semibold">{result.name}</span>
                {result.hasActiveBan ? <Badge tone="danger">BANLI</Badge> : null}
              </div>

              {/* Aranan isim güncel isimden farklıysa bunu göstermek şart:
                admin neden bu sonucun çıktığını anlamalı. */}
              {result.matchedName && result.matchedName !== result.name ? (
                <p className="mt-1 truncate text-sm text-fg-muted">
                  eşleşen eski isim:{' '}
                  <span className="font-semibold text-fg">{result.matchedName}</span>
                </p>
              ) : null}

              <p className="mt-1.5 truncate font-mono text-[11px] text-fg-muted">
                {result.steamId ?? '— Steam yok'} · {result.eosId ?? '— EOS yok'}
              </p>
            </div>

            {result.knownNames > 1 ? (
              <div className="shrink-0">
                <Badge>{result.knownNames} isim</Badge>
              </div>
            ) : null}
          </div>
        </Card>
      </Link>
    </li>
  );
}
