'use client';

import { cn } from '@/lib/cn';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';

/**
 * Genel navigasyon.
 *
 * Önce her sayfa kendi geri bağlantısını taşıyordu: profil "← Oyuncular"a,
 * yetkiler yine "← Oyuncular"a gidiyordu, kontrol paneline dönmenin yolu
 * yoktu ve çıkış düğmesi hiçbir sayfada görünmüyordu. Ayrıca silinmiş bir
 * sayfaya (`/canli`) bağlantı duruyordu.
 *
 * Artık tek bir çubuk her sayfada: nerede olduğun, nereye gidebileceğin ve
 * kim olduğun aynı yerde.
 */

interface Bolum {
  href: string;
  etiket: string;
  /** Bu izin yoksa bölüm hiç gösterilmiyor. */
  izin?: string;
}

const BOLUMLER: Bolum[] = [
  { href: '/', etiket: 'Panel' },
  { href: '/oyuncular', etiket: 'Oyuncular' },
  { href: '/kayitlar', etiket: 'Kayıtlar', izin: 'audit.read' },
  { href: '/yetkiler', etiket: 'Yetkiler', izin: 'admin_list.manage' },
];

export function AppNav({
  apiUrl,
  kullanici,
  izinler,
  superAdmin,
}: {
  apiUrl: string;
  kullanici: string;
  izinler: string[];
  superAdmin: boolean;
}) {
  const yol = usePathname();
  const [cikiyor, setCikiyor] = useState(false);

  const gorunur = BOLUMLER.filter((b) => !b.izin || superAdmin || izinler.includes(b.izin));

  async function cikis() {
    setCikiyor(true);
    await fetch(`${apiUrl}/auth/logout`, { method: 'POST', credentials: 'include' });
    window.location.href = '/';
  }

  return (
    // Yapışkan ve saydam: Apple arayüzlerinde üst çubuk içerikle birlikte
    // kaymaz, içeriğin üstünde durur ve arkasını bulanıklaştırır.
    <header className="sticky top-0 z-50 border-b border-border bg-bg-blur backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-12 w-full max-w-[110rem] items-center gap-1 px-5">
        <Link href="/" className="mr-4 text-[15px] font-semibold tracking-tight">
          Altai
        </Link>

        <nav className="flex items-center gap-1">
          {gorunur.map((b) => {
            // '/' her yolun öneki olduğu için tam eşleşme aranıyor; diğer
            // bölümlerde alt sayfalar da (profil gibi) etkin sayılıyor.
            const etkin = b.href === '/' ? yol === '/' : yol.startsWith(b.href);
            return (
              <Link
                key={b.href}
                href={b.href}
                className={cn(
                  'rounded-full px-3 py-1.5 text-[13px] transition-colors',
                  etkin ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {b.etiket}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-[13px] text-fg-muted sm:inline">{kullanici}</span>
          <button
            type="button"
            onClick={cikis}
            disabled={cikiyor}
            className="rounded-full px-3 py-1.5 text-[13px] text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
          >
            {cikiyor ? '…' : 'Çıkış'}
          </button>
        </div>
      </div>
    </header>
  );
}
