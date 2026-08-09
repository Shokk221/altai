'use client';

import { Button } from '@/components/ui/button';

export function LogoutButton({ apiUrl }: { apiUrl: string }) {
  async function handleLogout() {
    await fetch(`${apiUrl}/auth/logout`, { method: 'POST', credentials: 'include' });
    window.location.reload();
  }

  return (
    <Button variant="soft" size="sm" onClick={handleLogout}>
      Çıkış yap
    </Button>
  );
}
