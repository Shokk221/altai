'use client';

export function LogoutButton({ apiUrl }: { apiUrl: string }) {
  async function handleLogout() {
    await fetch(`${apiUrl}/auth/logout`, { method: 'POST', credentials: 'include' });
    window.location.reload();
  }

  return (
    <button type="button" onClick={handleLogout} className="underline">
      Çıkış yap
    </button>
  );
}
