'use client';

import { useState } from 'react';

export function BreakGlassLogin({ apiUrl }: { apiUrl: string }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch(`${apiUrl}/auth/break-glass`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      setError('Giriş başarısız');
      return;
    }
    window.location.reload();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-neutral-500 underline"
      >
        Discord kullanılamıyor mu?
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 text-sm">
      <input
        placeholder="kullanıcı adı"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="rounded border px-2 py-1"
      />
      <input
        type="password"
        placeholder="şifre"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="rounded border px-2 py-1"
      />
      {error && <p className="text-red-500">{error}</p>}
      <button type="submit" className="rounded bg-neutral-800 px-3 py-1 text-white">
        Acil giriş
      </button>
    </form>
  );
}
