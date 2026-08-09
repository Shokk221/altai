import { cn } from '@/lib/cn';
import type { ButtonHTMLAttributes } from 'react';

/**
 * Hap formlu düğmeler. `ink` (koyu) varyantı sayfada bir ya da iki kez
 * kullanılır — kontrast az yerde durunca değerli, her yere dağılınca
 * kompozisyonu ağırlaştırıyor.
 */
type Variant = 'ink' | 'accent' | 'soft' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  ink: 'bg-ink text-ink-fg hover:bg-ink/90',
  accent: 'bg-accent text-accent-fg hover:bg-accent/85',
  soft: 'bg-surface text-fg hover:bg-surface-2 shadow-card',
  ghost: 'text-fg-muted hover:text-fg hover:bg-surface-2',
  danger: 'bg-danger text-danger-fg hover:bg-danger/90',
};

const SIZES: Record<Size, string> = {
  // min-h-11: mobilde parmakla basılabilir hedef (~44px). Plan Bölüm 8:
  // "moderasyon aksiyonları tek elle kullanılabilir".
  sm: 'min-h-9 px-4 text-sm',
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
