import { cn } from '@/lib/cn';
import type { HTMLAttributes, ReactNode } from 'react';

/**
 * Kart.
 *
 * Saf siyah zeminde yüzey farkı TEK BAŞINA yetmiyor: #000 ile #1a1a1c
 * arasındaki fark büyük ekranda ayırt ediliyor ama kart kart üstüne
 * gelince kayboluyor. 1 piksellik kenarlık sınırı çiziyor. (Önceki sıcak
 * kömür dilinde kenarlık yoktu ve orada doğruydu.)
 */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('rounded border border-border bg-surface', className)} />;
}

/**
 * Yükseltilmiş kart: gölgeli. Sayfada en fazla bir tane — çoğaltılırsa
 * yükseklik anlamını yitiriyor.
 */
export function CardInk({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn('rounded border border-border-strong bg-surface shadow-lift', className)}
    />
  );
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 pt-3.5 pb-2.5">
      <h2 className="text-sm font-semibold">{title}</h2>
      {action}
    </div>
  );
}

export function CardBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn('px-4 pt-3 pb-4', className)} />;
}
