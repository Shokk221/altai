'use client';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/cn';
import { useState } from 'react';

/**
 * Ban kaldırma penceresi — GEREKÇE ZORUNLU.
 *
 * Önce "Banı kaldır" tek tıkta çalışıyordu: onay yok, gerekçe yok.
 * İki sorunu vardı. Birincisi yanlışlıkla basmak; ban kaydı kalıcı
 * olarak "kaldırıldı" oluyor ve geri alınamıyor (ikinci kez kaldırma
 * api'de reddediliyor, ilk kaydı korumak için). İkincisi ve asıl
 * önemlisi: aylar sonra "bu ban neden düştü" sorusunun cevabı hiçbir
 * yerde olmuyordu.
 *
 * Bir banın kaldırılması, verilmesi kadar bir karar. Ban verirken kural
 * seçmeyi zorunlu kıldık; kaldırırken de gerekçe isteniyor.
 *
 * HAZIR GEREKÇELER en sık üç durum için. Tek tıkla seçiliyor ama metin
 * düzenlenebilir kalıyor: hazır seçenek düşünmenin yerine geçmemeli,
 * yalnızca yazmanın yerine geçmeli.
 */

const HAZIR = ['İtiraz kabul edildi.', 'Yanlış oyuncu banlandı.', 'Yetkili hatası — ban geçersiz.'];

export function BanKaldirPenceresi({
  acik,
  onKapat,
  onGonder,
  bekliyor,
  hata,
}: {
  acik: boolean;
  onKapat: () => void;
  onGonder: (gerekce: string) => void;
  bekliyor: boolean;
  hata: string | null;
}) {
  const [gerekce, setGerekce] = useState('');
  // api en az 3 karakter istiyor; düğme ondan önce açılmamalı.
  const gonderilebilir = gerekce.trim().length >= 3 && !bekliyor;

  return (
    <Modal
      acik={acik}
      onKapat={onKapat}
      baslik="Banı kaldır"
      aciklama="Bu ban neden kaldırılıyor? Gerekçe kayıtlara yazılıyor."
      altBilgi={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {hata ? <span className="mr-auto text-xs font-medium text-danger">{hata}</span> : null}
          <Button variant="ghost" size="sm" onClick={onKapat} disabled={bekliyor}>
            Vazgeç
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => onGonder(gerekce.trim())}
            disabled={!gonderilebilir}
          >
            {bekliyor ? 'Kaldırılıyor…' : 'Banı kaldır'}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <section>
          <h3 className="text-footnote font-semibold">
            Gerekçe <span className="font-normal text-danger">zorunlu</span>
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {HAZIR.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => setGerekce(h)}
                aria-pressed={gerekce === h}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs transition-colors',
                  gerekce === h
                    ? 'border-accent bg-accent-weak text-accent-2'
                    : 'border-border text-fg-muted hover:border-border-strong hover:text-fg',
                )}
              >
                {h}
              </button>
            ))}
          </div>
          <Textarea
            value={gerekce}
            onChange={(e) => setGerekce(e.target.value)}
            rows={3}
            placeholder="Örn: İtiraz kabul edildi, kayıtlarda kasıt görünmüyor."
            aria-label="Kaldırma gerekçesi"
            className="mt-2"
          />
        </section>

        <p className="text-2xs leading-relaxed text-fg-faint">
          Ban kaydı silinmiyor, "kaldırıldı" olarak işaretleniyor — geçmiş moderasyon kayıtları ona
          atıfta bulunuyor. Bu işlem geri alınamıyor: ikinci kez kaldırma reddediliyor, ilk
          kaldıranın kaydı korunsun diye.
        </p>
      </div>
    </Modal>
  );
}
