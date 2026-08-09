import { cn } from '@/lib/cn';
import type { InputHTMLAttributes } from 'react';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'min-h-11 w-full rounded border border-border bg-surface-2 px-3 text-sm',
        'placeholder:text-fg-muted/70',
        // Mobil Safari 16px altındaki yazı tipinde otomatik yakınlaştırma
        // yapıyor; text-base ile bunu engelliyoruz.
        'text-base sm:text-sm',
        className,
      )}
    />
  );
}
