import { cn } from '@/lib/cn';
import type { InputHTMLAttributes } from 'react';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'min-h-12 w-full rounded-full bg-surface px-5 shadow-card',
        'border-0 placeholder:text-fg-muted/70',
        // Mobil Safari 16px altındaki yazı tipinde otomatik yakınlaştırma
        // yapıyor; text-base ile bunu engelliyoruz.
        'text-base sm:text-sm',
        className,
      )}
    />
  );
}
