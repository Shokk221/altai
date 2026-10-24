import Link from 'next/link';

export const metadata = { title: 'Bulunamadı - Altai' };

/**
 * 404.
 *
 * Yalnızca yanlış adres için değil: oyuncu, klan, talep ve savaş sayfaları
 * kayıt yoksa `notFound()` çağırıyor. Metin ikisini de karşılıyor. Önce
 * Next'in varsayılan İngilizce sayfası çıkıyordu ve panele dönüş yolu
 * yoktu.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-md flex-col items-center justify-center px-5 py-16 text-center">
      <p className="num text-footnote font-semibold text-fg-faint">404</p>
      <h1 className="display mt-2 text-2xl">Bulunamadı</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Adres yanlış yazılmış ya da kayıt silinmiş olabilir.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex min-h-11 items-center rounded-full bg-ink px-5 text-sm font-medium text-ink-fg transition-colors hover:bg-accent-2"
      >
        Panele dön
      </Link>
    </main>
  );
}
