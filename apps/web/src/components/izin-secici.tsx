'use client';

import { cn } from '@/lib/cn';
import type { Etiket, Kume } from '@/lib/yetki-etiketleri';

/**
 * Gruplanmış izin seçimi — panel izinleri ve oyun içi izinler için aynı.
 *
 * Önce izinler yan yana ham anahtar düğmeleriydi (`player.team_change`).
 * Ne açtığını anlamak için anahtarı okuyup tahmin etmek gerekiyordu; burada
 * her satırda Türkçe ad ve bir cümlelik açıklama var.
 *
 * Gerçek `<input type="checkbox">`: klavye ve ekran okuyucu için ayrıca bir
 * şey yazmak gerekmiyor.
 */
export function IzinSecici({
  kumeler,
  sozluk,
  secili,
  degistir,
  kilitli,
}: {
  kumeler: Kume[];
  sozluk: Record<string, Etiket>;
  secili: string[];
  degistir: (anahtar: string) => void;
  /** Seçilemeyen anahtarlar ve sebebi (ör. whitelist grubunda `kick`). */
  kilitli?: (anahtar: string) => string | null;
}) {
  return (
    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
      {kumeler.map((k) => (
        <fieldset key={k.baslik}>
          <legend className="mb-1 text-xs font-semibold text-fg-muted">{k.baslik}</legend>
          <div className="flex flex-col">
            {k.anahtarlar.map((a) => {
              const kilit = kilitli?.(a) ?? null;
              const acik = secili.includes(a);
              return (
                <label
                  key={a}
                  title={kilit ?? undefined}
                  className={cn(
                    '-mx-2 flex items-start gap-2.5 rounded-sm px-2 py-1.5 transition-colors',
                    kilit ? 'cursor-not-allowed opacity-40' : 'cursor-pointer hover:bg-surface-2',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={acik}
                    disabled={kilit !== null && !acik}
                    onChange={() => degistir(a)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-accent"
                  />
                  <span className="min-w-0">
                    <span className="block text-footnote font-medium text-fg">
                      {sozluk[a]?.ad ?? a}
                    </span>
                    <span className="block text-2xs text-fg-faint">{sozluk[a]?.aciklama ?? a}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

/** API'nin hata gövdesinden okunabilir metin. */
export async function hataMetni(res: Response, varsayilan: string): Promise<string> {
  const g = (await res.json().catch(() => ({}))) as { error?: string; detay?: string };
  return g.detay ?? g.error ?? varsayilan;
}
