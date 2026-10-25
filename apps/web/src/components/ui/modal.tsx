'use client';

import { cn } from '@/lib/cn';
import { type ReactNode, useCallback, useEffect, useRef } from 'react';

/**
 * Açılan pencere.
 *
 * Panelde bu kalıp zaten vardı (takım değiştirme kutusu) ama tek yerde
 * gömülüydü; moderasyon eylemleri satır içi formlar kullanıyordu. Satır
 * içi form açılınca sayfanın düzeni kayıyordu: ban formu açılır açılmaz
 * altındaki her şey aşağı itiliyor, moderatör az önce okuduğu satırı
 * kaybediyordu. Üstelik form dar bir şeride sıkışıyor ve yalnızca tek
 * satırlık bir sebep alabiliyordu.
 *
 * TARAYICININ KENDİ `<dialog>` ÖĞESİ KULLANILIYOR, elle kurulmuş bir
 * kutu değil. Önce `role="dialog"` verilmiş bir `div` vardı ve odağı
 * yalnızca açılışta içeri alıyordu: Tab'a basmaya devam eden biri
 * pencerenin dışına, arkadaki sayfaya çıkıyordu. `showModal()` bunu
 * tarayıcı düzeyinde çözüyor — odak tuzağı, arka planın etkisizleşmesi
 * ve Escape bedava geliyor.
 *
 * Geriye iki şey kalıyor: dışarı tıklayınca kapanması ve arka planın
 * kaymaması.
 */
export function Modal({
  baslik,
  aciklama,
  acik,
  onKapat,
  genislik = 'md',
  children,
  altBilgi,
}: {
  baslik: string;
  /** Başlığın altındaki tek satır: pencerenin ne yaptığı. */
  aciklama?: ReactNode;
  acik: boolean;
  onKapat: () => void;
  /** `lg` uzun formlar için (ban penceresi kural listesi taşıyor). */
  genislik?: 'md' | 'lg';
  children: ReactNode;
  /** Düğme satırı — pencerenin altına yapışık. */
  altBilgi?: ReactNode;
}) {
  const pencere = useRef<HTMLDialogElement | null>(null);
  const kutu = useRef<HTMLDivElement | null>(null);

  // `onKapat` her render'da yeniden oluşabiliyor; etkinin ona bağlı
  // olmaması için sabitleniyor.
  const kapat = useCallback(() => onKapat(), [onKapat]);

  useEffect(() => {
    const p = pencere.current;
    if (!p) return;

    if (acik && !p.open) p.showModal();
    if (!acik && p.open) p.close();

    if (!acik) return;

    // Arka plan kaymasın: `showModal` etkileşimi engelliyor ama
    // tekerlek bazı tarayıcılarda hâlâ sayfayı kaydırıyor.
    const oncekiTasma = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = oncekiTasma;
    };
  }, [acik]);

  return (
    <dialog
      ref={pencere}
      aria-label={baslik}
      // Escape ve kapanış: ikisi de `close` olayına düşüyor, durum tek
      // yerden güncelleniyor.
      onClose={kapat}
      onCancel={(e) => {
        e.preventDefault();
        kapat();
      }}
      // Dışarı tıklamak kapatıyor. Tıklama `dialog`'un kendisine
      // düşüyorsa (yani kutunun dışına) kapanıyor.
      onMouseDown={(e) => {
        if (!kutu.current?.contains(e.target as Node)) kapat();
      }}
      className={cn(
        // `<dialog>` varsayılanları: kenarlık, dolgu ve otomatik
        // kenar boşluğu. Hepsi siliniyor.
        'm-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] border-0 bg-transparent p-0',
        'backdrop:bg-black/50 backdrop:backdrop-brightness-50',
        genislik === 'lg' ? 'max-w-2xl' : 'max-w-md',
      )}
    >
      {acik ? (
        <div
          ref={kutu}
          className="flex max-h-[calc(100dvh-2rem)] animate-sheet-in flex-col rounded-lg border border-border-strong bg-surface text-fg shadow-lift"
        >
          <header className="shrink-0 border-b border-border px-5 pt-4 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-subhead font-semibold">{baslik}</h2>
                {aciklama ? (
                  <div className="mt-1 text-footnote text-fg-muted">{aciklama}</div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={kapat}
                aria-label="Kapat"
                className="-mr-1.5 -mt-0.5 shrink-0 rounded-full px-2 py-1 text-fg-faint transition-colors hover:bg-surface-2 hover:text-fg"
              >
                <svg
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
          </header>

          {/* Gövde kendi içinde kayıyor: kural listesi uzun olabilir ama
              pencere ekranı taşmamalı. */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {altBilgi ? (
            <footer className="shrink-0 border-t border-border px-5 py-3">{altBilgi}</footer>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
