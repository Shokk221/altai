import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

type Tone = 'neutral' | 'accent' | 'danger' | 'success' | 'info' | 'warn';

/**
 * Çip rozet — Apple dili.
 *
 * Renkli tonlar SAYDAM zemin + renkli metin. Dolu renk zeminler saf siyahta
 * çok bağırıyor ve bir satırda iki rozet yan yana geldiğinde okunabilirliği
 * bozuyor. Tek istisna yok: ban rozeti de saydam, çünkü satırın kendisi
 * zaten kırmızı metinle işaretli.
 */
const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-muted',
  accent: 'bg-accent-weak text-accent-2',
  danger: 'bg-danger/15 text-danger',
  success: 'bg-success/15 text-success',
  info: 'bg-info/15 text-info',
  warn: 'bg-warn/15 text-warn',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium',
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}
