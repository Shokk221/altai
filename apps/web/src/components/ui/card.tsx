import { cn } from '@/lib/cn';
import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Kartlar kenarlıkla değil yüzey farkı + yumuşak gölgeyle ayrılıyor.
 * Sıcak zeminde ince gri çizgiler kompozisyonu kirletiyor.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('rounded bg-surface shadow-card', className)} />;
}

/** Koyu kart: sayfada en fazla bir tane. Dikkati oraya çeker. */
export function CardInk({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('rounded bg-ink text-ink-fg', className)} />;
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-1">
      <h2 className="text-base font-medium">{title}</h2>
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('px-5 pb-5 pt-3', className)} />;
}
