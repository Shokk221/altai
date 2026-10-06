'use client';

import { cn } from '@/lib/cn';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

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
  /**
   * Bu izin yoksa bölüm hiç gösterilmiyor. Dizi verilirse HERHANGİ BİRİ
   * yetiyor — api tarafındaki guard ile aynı kural. İkisi ayrışırsa menüde
   * görünmeyen ama erişilebilen (ya da tersi) bir sayfa ortaya çıkıyor.
   */
  izin?: string | string[];
}

const BOLUMLER: Bolum[] = [
  { href: '/', etiket: 'Panel' },
  { href: '/oyuncular', etiket: 'Oyuncular' },
  { href: '/siralama', etiket: 'Sıralama' },
  { href: '/kayitlar', etiket: 'Kayıtlar', izin: 'audit.read' },
  { href: '/kamera', etiket: 'Kamera', izin: 'audit.read' },
  { href: '/yetkiler', etiket: 'Yetkiler', izin: 'admin_list.manage' },
  { href: '/klanlar', etiket: 'Klanlar', izin: ['plugin_config.write', 'clan.manage'] },
  { href: '/kurallar', etiket: 'Kurallar', izin: 'rules.manage' },
  { href: '/talepler', etiket: 'Talepler', izin: 'ticket.manage' },
  { href: '/klan-savaslari', etiket: 'Savaşlar', izin: ['clan.manage', 'plugin_config.write'] },
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
  const serit = useRef<HTMLElement | null>(null);

  const gorunur = BOLUMLER.filter((b) => {
    if (!b.izin || superAdmin) return true;
    const gerekli = Array.isArray(b.izin) ? b.izin : [b.izin];
    return gerekli.some((p) => izinler.includes(p));
  });
  // '/' her yolun öneki olduğu için tam eşleşme aranıyor; diğer bölümlerde
  // alt sayfalar da (profil gibi) etkin sayılıyor.
  const etkinMi = (href: string) => (href === '/' ? yol === '/' : yol.startsWith(href));
  const etkinHref = gorunur.find((b) => etkinMi(b.href))?.href;

  // Dar ekranda menü yana kayıyor; bölüm değişince etkin olan görünür
  // alana getiriliyor. Yoksa "Talepler"deyken hangi sayfada olduğun
  // şeridin kaymış dışında kalıyordu.
  useEffect(() => {
    if (!etkinHref) return;
    serit.current
      ?.querySelector(`a[href="${etkinHref}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [etkinHref]);

  async function cikis() {
    setCikiyor(true);
    await fetch(`${apiUrl}/auth/logout`, { method: 'POST', credentials: 'include' });
    window.location.href = '/';
  }

  return (
    // Yapışkan ve saydam: Apple arayüzlerinde üst çubuk içerikle birlikte
    // kaymaz, içeriğin üstünde durur ve arkasını bulanıklaştırır.
    <header className="sticky top-0 z-50 border-b border-border bg-bg-blur backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-12 w-full max-w-[110rem] items-center gap-1 px-4 sm:px-5">
        <Link href="/" className="mr-3 shrink-0 text-subhead font-semibold sm:mr-4">
          Altai
        </Link>

        {/* On bölüm dar ekrana sığmıyor. Önce taşan kısım `overflow-x:
            hidden` altında görünmez oluyordu: telefonda Talepler'e ve
            Savaşlar'a hiç ulaşılamıyordu. Artık şerit yana kayıyor. */}
        <nav
          ref={serit}
          className="scrollbar-none -mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1"
        >
          {gorunur.map((b) => {
            const etkin = b.href === etkinHref;
            return (
              <Link
                key={b.href}
                href={b.href}
                aria-current={etkin ? 'page' : undefined}
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-footnote transition-colors',
                  etkin ? 'bg-surface-2 text-fg' : 'text-fg-muted hover:text-fg',
                )}
              >
                {b.etiket}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-3 pl-2">
          <span className="hidden text-footnote text-fg-muted sm:inline">{kullanici}</span>
          <button
            type="button"
            onClick={cikis}
            disabled={cikiyor}
            className="rounded-full px-3 py-1.5 text-footnote text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
          >
            {cikiyor ? '…' : 'Çıkış'}
          </button>
        </div>
      </div>
    </header>
  );
}
