import type { Kural } from '@/components/kurallar';
import { OyuncuProfili } from '@/components/oyuncu/profil-ekrani';
import type { Profil } from '@/components/oyuncu/tipler';
import { getJson, getMe, publicApiUrl } from '@/lib/api';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Oyuncu - Altai' };

/**
 * Oyuncu profili sayfası.
 *
 * Bu dosya yalnızca VERİ VE YETKİ. İşaretlemenin tamamı
 * `components/oyuncu/profil-ekrani.tsx` içinde: aynı ekran örnek
 * veriyle de basılabiliyor, böylece tasarım api olmadan görülüp
 * ölçülebiliyor (demo kipi: `pnpm --filter @altai/web dev:demo`).
 *
 * Veri tipleri `components/oyuncu/tipler.ts` içinde — sayfa, ekran ve
 * örnek veri aynı şekli paylaşıyor; tip tek yerde durmazsa üçü sessizce
 * ayrışıyor.
 */
export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  // Kurallar ban penceresinde ZORUNLU seçim olarak kullanılıyor; profil
  // ile birlikte çekiliyor ki pencere açılınca beklemesin.
  const [profil, kuralVeri] = await Promise.all([
    getJson<Profil>(`/players/${id}`),
    getJson<{ rules: Kural[] }>('/rules'),
  ]);

  if (!me) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
        <h1 className="display text-2xl">Giriş gerekli</h1>
        <p className="mt-2 text-sm text-fg-muted">
          Oyuncu profillerini görmek için panele giriş yapın.
        </p>
        <Link href="/" className="mt-5 inline-block text-sm font-semibold text-accent">
          Girişe dön
        </Link>
      </main>
    );
  }
  if (profil === undefined) notFound();
  if (!profil) {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
        <h1 className="display text-2xl">Profil yüklenemedi</h1>
        <p className="mt-2 text-sm text-fg-muted">Yetkiniz olmayabilir ya da api yanıt vermiyor.</p>
      </main>
    );
  }

  const yetki = (p: string) => me.permissions.includes(p) || me.systemRole === 'super_admin';

  return (
    <OyuncuProfili
      profil={profil}
      apiUrl={publicApiUrl()}
      kurallar={kuralVeri?.rules ?? []}
      yetkiler={{
        banlayabilir: yetki('player.ban'),
        notYazabilir: yetki('player.note.write'),
        etiketYonetir: yetki('flag.manage'),
      }}
    />
  );
}
