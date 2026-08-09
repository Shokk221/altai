'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useState } from 'react';

/**
 * Discord kesintisinde ya da henüz yapılandırılmadığında kullanılan acil
 * giriş. Varsayılan olarak kapalı duruyor: normal yol Discord, bu bir
 * kaçış kapısı ve öyle görünmeli.
 */
export function BreakGlassLogin({ apiUrl }: { apiUrl: string }) {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/auth/break-glass`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.status === 429) {
        setError('Çok fazla deneme yapıldı. Bir dakika sonra tekrar deneyin.');
        return;
      }
      if (!res.ok) {
        setError('Kullanıcı adı veya şifre hatalı.');
        return;
      }
      window.location.reload();
    } catch {
      setError('Sunucuya ulaşılamadı.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Discord kullanılamıyor mu?
      </Button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full max-w-xs flex-col gap-3">
      <Input
        placeholder="Kullanıcı adı"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="username"
        aria-label="Kullanıcı adı"
      />
      <Input
        type="password"
        placeholder="Şifre"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="current-password"
        aria-label="Şifre"
      />
      {error ? (
        <p className="px-1 text-sm font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="ink" disabled={busy}>
        {busy ? 'Giriliyor…' : 'Acil giriş'}
      </Button>
    </form>
  );
}
