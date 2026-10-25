import { cn } from '@/lib/cn';
import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';

/**
 * Girdi alanı.
 *
 * Kart yüzeyinden DAHA KOYU: Apple arayüzlerinde girdi alanı çukurdur,
 * yüzeyle aynı tonda olursa tıklanabilir olduğu anlaşılmıyor. Köşe hap
 * değil yumuşak kare — uzun metin alanlarında hap form metni kenarlara
 * sıkıştırıyor.
 */
export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'min-h-11 w-full rounded-sm border border-border-strong bg-surface-sunken px-3.5',
        'placeholder:text-fg-faint',
        'focus:border-accent focus:outline-none',
        // Mobil Safari 16px altındaki yazı tipinde otomatik yakınlaştırma
        // yapıyor; text-base ile bunu engelliyoruz.
        'text-base sm:text-sm',
        className,
      )}
    />
  );
}

/**
 * Çok satırlı girdi.
 *
 * Input ile aynı yüzey ve kenarlık; tek farkı dikey dolgu ve satır
 * aralığı. Moderasyon kayıtları tek satıra sığmıyor: olay anlatılırken
 * yetkililer kısaltmak zorunda kalıyordu.
 */
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        'w-full rounded-sm border border-border-strong bg-surface-sunken px-3.5 py-2.5',
        'placeholder:text-fg-faint',
        'focus:border-accent focus:outline-none',
        'leading-relaxed',
        // Mobil Safari 16px altında otomatik yakınlaştırıyor.
        'text-base sm:text-sm',
        className,
      )}
    />
  );
}
