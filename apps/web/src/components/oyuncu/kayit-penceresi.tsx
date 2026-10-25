'use client';

import type { Kural } from '@/components/kurallar';
import { kuralAra, kuralKodu, kuralOzeti } from '@/components/oyuncu/kural';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/cn';
import { useMemo, useState } from 'react';

/**
 * Not / uyarı / takip penceresi.
 *
 * Ban penceresiyle aynı kalıpta ama KURAL ZORUNLU DEĞİL: bir not her
 * zaman bir ihlale bağlı olmuyor ("Türkçe bilmiyor, İngilizce
 * anlaşıyor" gibi notlar da bu tabloda). Uyarıda kural seçmek
 * faydalı, o yüzden seçici orada da duruyor.
 *
 * Metin alanı TEK SATIR DEĞİL. Önceki satır içi form tek satırlık bir
 * `input` kullanıyordu; bir olayı anlatan not oraya sığmıyordu ve
 * yetkililer kısaltarak yazıyordu.
 *
 * Üç tür tek pencerede: açılırken hangi düğmeye basıldıysa o seçili
 * geliyor ama pencere içinde değiştirilebiliyor — yanlış düğmeye
 * basınca kapatıp yeniden açmak gerekmiyor.
 */

export type KayitTuru = 'note' | 'warning' | 'watchlist';

const TURLER: { tur: KayitTuru; ad: string; aciklama: string }[] = [
  { tur: 'note', ad: 'Not', aciklama: 'Yalnızca yetkililer görür. Oyuncuya bildirilmez.' },
  { tur: 'warning', ad: 'Uyarı', aciklama: 'Resmî uyarı kaydı. Sonraki ban kararında dayanak.' },
  {
    tur: 'watchlist',
    ad: 'Takip',
    aciklama: 'Açık kalır ve profilde işaretli durur; bir sonraki olayda bakılır.',
  },
];

export function KayitPenceresi({
  acik,
  onKapat,
  onGonder,
  ilkTur,
  kurallar,
  oyuncuAdi,
  bekliyor,
  hata,
}: {
  acik: boolean;
  onKapat: () => void;
  onGonder: (veri: { kind: KayitTuru; body: string }) => void;
  ilkTur: KayitTuru;
  kurallar: Kural[];
  oyuncuAdi: string;
  bekliyor: boolean;
  hata: string | null;
}) {
  const [tur, setTur] = useState<KayitTuru>(ilkTur);
  const [metin, setMetin] = useState('');
  const [kuralId, setKuralId] = useState<string | null>(null);
  const [arama, setArama] = useState('');

  const aktifKurallar = useMemo(
    () => kurallar.filter((k) => k.active !== false).sort((a, b) => a.position - b.position),
    [kurallar],
  );
  const bulunan = useMemo(() => kuralAra(aktifKurallar, arama), [aktifKurallar, arama]);
  const secili = aktifKurallar.find((k) => k.id === kuralId) ?? null;
  const turBilgi = TURLER.find((t) => t.tur === tur) ?? TURLER[0];

  // Kural seçiliyse kodu metnin başına yazılıyor: kayıt da bana gibi
  // hangi kurala dayandığını taşısın.
  const govde = secili
    ? `${kuralKodu(secili)} · ${kuralOzeti(secili)} — ${metin.trim()}`
    : metin.trim();
  const gonderilebilir = metin.trim().length > 0 && !bekliyor;

  return (
    <Modal
      acik={acik}
      onKapat={onKapat}
      baslik={`${oyuncuAdi} için kayıt`}
      aciklama={turBilgi?.aciklama}
      altBilgi={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {hata ? <span className="mr-auto text-xs font-medium text-danger">{hata}</span> : null}
          <Button variant="ghost" size="sm" onClick={onKapat} disabled={bekliyor}>
            Vazgeç
          </Button>
          <Button
            size="sm"
            onClick={() => onGonder({ kind: tur, body: govde })}
            disabled={!gonderilebilir}
          >
            {bekliyor ? 'Ekleniyor…' : `${turBilgi?.ad} ekle`}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <section>
          <h3 className="text-footnote font-semibold">Tür</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {TURLER.map((t) => (
              <button
                key={t.tur}
                type="button"
                onClick={() => setTur(t.tur)}
                aria-pressed={tur === t.tur}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  tur === t.tur
                    ? 'border-accent bg-accent-weak text-accent-2'
                    : 'border-border text-fg-muted hover:border-border-strong hover:text-fg',
                )}
              >
                {t.ad}
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="text-footnote font-semibold">Ne oldu?</h3>
          <Textarea
            value={metin}
            onChange={(e) => setMetin(e.target.value)}
            rows={4}
            placeholder="Olayı yazın. Sonraki yetkili bunu okuyup karar verecek."
            aria-label="Kayıt metni"
            className="mt-2"
          />
        </section>

        <section>
          <h3 className="text-footnote font-semibold">
            İlgili kural <span className="font-normal text-fg-faint">isteğe bağlı</span>
          </h3>

          {/* 52 kural çip olarak basılamaz: aranabilir kısa liste.
              Ban penceresiyle aynı kalıp. */}
          <Input
            value={arama}
            onChange={(e) => setArama(e.target.value)}
            placeholder="Kural ara: kod ya da kelime"
            aria-label="Kural ara"
            className="mt-2"
          />
          <div className="mt-2 max-h-44 overflow-y-auto rounded-sm border border-border">
            <button
              type="button"
              onClick={() => setKuralId(null)}
              aria-pressed={kuralId === null}
              className={cn(
                'w-full border-b border-border px-3 py-2 text-left text-footnote transition-colors',
                kuralId === null ? 'bg-accent-weak text-accent-2' : 'hover:bg-surface-2',
              )}
            >
              Kurala bağlama
            </button>
            {bulunan.map((k) => {
              const bu = k.id === kuralId;
              return (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setKuralId(k.id)}
                  aria-pressed={bu}
                  className={cn(
                    'flex w-full items-baseline gap-2 border-b border-border px-3 py-2 text-left transition-colors last:border-0',
                    bu ? 'bg-accent-weak' : 'hover:bg-surface-2',
                  )}
                >
                  <span
                    className={cn(
                      'num w-20 shrink-0 text-2xs font-semibold',
                      bu ? 'text-accent-2' : 'text-fg-faint',
                    )}
                  >
                    {kuralKodu(k)}
                  </span>
                  <span className="min-w-0 flex-1 text-footnote leading-snug">{kuralOzeti(k)}</span>
                </button>
              );
            })}
            {bulunan.length === 0 ? (
              <p className="px-3 py-2 text-xs text-fg-muted">Eşleşen kural yok.</p>
            ) : null}
          </div>
        </section>

        {secili ? (
          <section>
            <h3 className="text-footnote font-semibold">Kayda şu yazılacak</h3>
            <p className="mt-2 rounded-sm border border-border bg-surface-sunken px-3 py-2.5 text-footnote leading-relaxed">
              {govde}
            </p>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
