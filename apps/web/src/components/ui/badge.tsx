import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

type Tone = 'neutral' | 'accent' | 'danger' | 'success' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-fg-muted',
  accent: 'bg-accent text-accent-fg',
  // Ban rozeti dolu koyu kırmızı: listedeki en önemli tek bilgi, saydam
  // bir zeminle fısıldanmamalı.
  danger: 'bg-danger text-danger-fg',
  success: 'bg-success/20 text-success',
  info: 'bg-info/20 text-info',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide',
        TONES[tone],
      )}
    >
      {children}
    </span>
  );
}
