'use client';

import { useEffect, useState } from 'react';

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

export function LiveServerStatus({ wsUrl }: { wsUrl: string }) {
  const [servers, setServers] = useState<Record<string, LiveServerState>>({});
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let socket: WebSocket;
    try {
      socket = new WebSocket(wsUrl);
    } catch {
      return;
    }

    socket.onopen = () => setConnected(true);
    socket.onclose = () => setConnected(false);
    socket.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as
          | { type: 'snapshot'; servers: LiveServerState[] }
          | { type: 'update'; serverSlug: string; state: LiveServerState };

        if (msg.type === 'snapshot') {
          const map: Record<string, LiveServerState> = {};
          for (const s of msg.servers) map[s.serverSlug] = s;
          setServers(map);
        } else {
          setServers((prev) => ({ ...prev, [msg.serverSlug]: msg.state }));
        }
      } catch {
        // yoksay
      }
    };

    return () => socket.close();
  }, [wsUrl]);

  const serverList = Object.values(servers);

  return (
    <div className="w-full max-w-md rounded border p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
        <span>Canlı sunucu durumu</span>
        <span className={connected ? 'text-green-500' : 'text-neutral-400'}>
          {connected ? '● bağlı' : '○ bağlanıyor…'}
        </span>
      </div>
      {serverList.length === 0 ? (
        <p className="text-sm text-neutral-500">Henüz bağlı bir agent yok.</p>
      ) : (
        serverList.map((s) => (
          <div key={s.serverSlug} className="mb-3 last:mb-0">
            <p className="font-medium">
              {s.serverSlug} — {s.playerCount} oyuncu
              {s.queueCount > 0 ? ` (+${s.queueCount} kuyruk)` : ''}
            </p>
            {s.layer && <p className="text-xs text-neutral-500">{s.layer}</p>}
            <ul className="mt-1 text-sm">
              {s.players.map((p) => (
                <li key={p.steamId}>{p.name}</li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
