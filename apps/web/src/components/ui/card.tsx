import { cn } from '@/lib/cn';
import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Kartlar kenarlıkla değil yüzey farkıyla ayrılıyor. Koyu zeminde gölge
 * neredeyse görünmüyor; ayrımı açıklık farkı yapıyor.
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('rounded bg-surface', className)} />;
}

/**
 * Açık kart: koyu zeminde dikkat çeken şey açıklıktır. Sayfada en fazla
 * bir tane — çoğaltılırsa kontrast anlamını yitirir.
 */
export function CardInk({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('rounded bg-ink text-ink-fg shadow-lift', className)} />;
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-1">
      <h2 className="text-base font-semibold">{title}</h2>
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('px-5 pb-5 pt-3', className)} />;
}
