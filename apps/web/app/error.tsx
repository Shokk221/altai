'use client';

import Link from 'next/link';

/**
 * Sayfa hatası.
 *
 * Bir sayfa render sırasında patlarsa (api beklenmeyen bir cevap döndü,
 * veri biçimi değişti) Next'in varsayılan İngilizce ekranı çıkıyordu. Üst
 * çubuk yerinde kalıyor — bu dosya kök yerleşimin İÇİNDE çalışıyor — ve
 * "Tekrar dene" sayfayı baştan yüklemeden yalnızca bu bölümü yeniden
 * deniyor.
 *
 * Hata kodu (digest) gösteriliyor: sunucu günlüğünde aynı kodla aranıp
 * gerçek hata bulunabiliyor. Hatanın metni gösterilmiyor; üretimde Next
 * onu zaten gizliyor ve iç ayrıntı sızdırmamalı.
 */
export default function Hata({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center px-5 py-16 text-center">
      <h1 className="display text-2xl">Bu sayfa yüklenemedi</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Tekrar deneyin. Sorun sürerse api ayakta mı diye bakın.
      </p>
      {error.digest ? (
        <p className="mt-3 font-mono text-2xs text-fg-faint">Hata kodu: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-sm font-medium text-ink-fg transition-colors hover:bg-accent-2"
        >
          Tekrar dene
        </button>
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-full px-5 text-sm text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg"
        >
          Panele dön
        </Link>
      </div>
    </main>
  );
}
