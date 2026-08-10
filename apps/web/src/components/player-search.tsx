'use client';

import { Badge } from '@/components/ui/badge';
import { EmptyState, Skeleton } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { tarih } from '@/lib/format';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

interface Result {
  id: string;
  steamId: string | null;
  eosId: string | null;
  name: string;
  matchedName: string | null;
  /** Güncel isim hariç, en son kullanılan diğer isimler. */
  eskiIsimler: string[];
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
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
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
        // Kart yığını yerine TABLO: liste taranmak için, okunmak için değil.
        // Kartlar dikeyde yer yiyip ekrana üç sonuç sığdırıyordu ve ekranın
        // genişliğini hiç kullanmıyordu. Sütunlar aynı bilgiyi göz tek
        // hizada tarayacak şekilde diziyor.
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full min-w-[54rem] text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[10.5px] font-semibold uppercase tracking-wider text-fg-faint">
                <th className="px-3 py-2">Oyuncu</th>
                <th className="px-3 py-2">Eski isimler</th>
                <th className="px-3 py-2">Steam</th>
                <th className="px-3 py-2">EOS</th>
                <th className="px-3 py-2 text-right">Son görülme</th>
              </tr>
            </thead>
            <tbody className="[&>tr:last-child]:border-0">
              {state.results.map((r) => (
                <PlayerRow key={r.id} result={r} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** Tablo satırı. Tüm satır tıklanabilir; hedef küçük olursa mobilde kullanılamıyor. */
function PlayerRow({ result }: { result: Result }) {
  return (
    <tr className="border-b border-border hover:bg-surface-2">
      <td className="max-w-0 px-3 py-2">
        <Link href={`/oyuncular/${result.id}`} className="block">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate font-semibold">{result.name}</span>
            {result.hasActiveBan ? <Badge tone="danger">banlı</Badge> : null}
            {result.flags.slice(0, 3).map((f) => (
              <Badge key={f} tone="info">
                {f}
              </Badge>
            ))}
            {result.flags.length > 3 ? (
              <span className="text-[11px] text-fg-faint">+{result.flags.length - 3}</span>
            ) : null}
          </div>
          {/* Aranan isim güncelden farklıysa göstermek şart: admin bu
              sonucun neden çıktığını anlamalı. */}
          {result.matchedName && result.matchedName !== result.name ? (
            <span className="mt-0.5 block truncate text-[11.5px] text-fg-muted">
              eşleşen: <span className="font-medium text-fg">{result.matchedName}</span>
            </span>
          ) : null}
        </Link>
      </td>

      <td className="max-w-0 px-3 py-2 text-fg-muted">
        <span className="block truncate">
          {result.eskiIsimler.length > 0 ? result.eskiIsimler.join(' · ') : '—'}
        </span>
        {result.knownNames > 1 ? (
          <span className="text-[11px] text-fg-faint">{result.knownNames} isim</span>
        ) : null}
      </td>

      <td className="px-3 py-2 font-mono text-[11px] text-fg-muted">{result.steamId ?? '—'}</td>
      <td className="px-3 py-2 font-mono text-[11px] text-fg-faint">{result.eosId ?? '—'}</td>
      <td className="num whitespace-nowrap px-3 py-2 text-right text-[11.5px] text-fg-muted">
        {tarih(result.sonGorulme)}
      </td>
    </tr>
  );
}
