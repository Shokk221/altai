import { cn } from '@/lib/cn';
import type { ButtonHTMLAttributes } from 'react';

/**
 * Hap formlu düğmeler — Apple dili.
 *
 * `ink` BİRİNCİL eylem ve mavi. Önceki dilde koyu zeminde açık bir yüzeydi;
 * burada birincil eylemin rengi vurgunun kendisi. Mavi başka hiçbir yerde
 * kullanılmıyor, o yüzden bir ekranda birden fazla mavi düğme varsa
 * hangisinin asıl eylem olduğu belirsizleşir — ikincil olanlar `soft`.
 *
 * Ağırlık 500: Apple arayüzünde düğme metni kalın değil, orta. 600 ve üstü
 * bu palette bağırıyor.
 */
type Variant = 'ink' | 'accent' | 'soft' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  ink: 'bg-ink text-ink-fg hover:bg-accent-2',
  accent: 'bg-accent text-accent-fg hover:bg-accent-2',
  soft: 'bg-surface-2 text-fg hover:bg-border-strong',
  ghost: 'text-fg-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-danger text-danger-fg hover:brightness-110',
};

const SIZES: Record<Size, string> = {
  // Dokunma hedefi: mobilde parmakla basılabilir olmalı (plan Bölüm 8).
  sm: 'min-h-8 px-3.5 text-[13px]',
  md: 'min-h-11 px-5 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ variant = 'ink', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors',
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    />
  );
}
