import type { ReactNode } from 'react';

/**
 * Boş/yükleniyor/hata durumları — plan Bölüm 8 bunları her sayfada
 * tasarlanmış olmaya zorluyor. Tek bileşen, üç durum.
 */
export function EmptyState({
  title,
  hint,
  tone = 'neutral',
}: {
  title: ReactNode;
  hint?: ReactNode;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <div className="px-4 py-12 text-center">
      <p className={tone === 'danger' ? 'text-danger' : 'text-fg-muted'}>{title}</p>
      {hint ? <p className="mt-1 text-sm text-fg-faint">{hint}</p> : null}
    </div>
  );
}

export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`animate-pulse rounded-sm bg-surface-2 ${className}`} />;
}
