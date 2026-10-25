'use client';

import { useState } from 'react';

/**
 * Kimliği panoya kopyalar.
 *
 * BattleMetrics'te her kimlik satırının yanında küçük bir kopyalama
 * ikonu var ve yetkililer onu refleksle kullanıyor: SteamID'yi ban
 * komutuna, Discord'a, başka bir panele yapıştırıyorlar. 17 haneli bir
 * sayıyı elle seçmek hem yavaş hem hatalı.
 *
 * Geri bildirim METİNDE, ayrı bir bildirim kutusunda değil: düğmenin
 * kendisi iki saniye "kopyalandı" diyor. Ekranın köşesinde beliren bir
 * kutu, bu kadar sık yapılan bir iş için fazla gürültülü.
 */
export function Kopyala({ deger, etiket }: { deger: string; etiket: string }) {
  const [kopyalandi, setKopyalandi] = useState(false);

  async function kopyala() {
    try {
      await navigator.clipboard.writeText(deger);
      setKopyalandi(true);
      setTimeout(() => setKopyalandi(false), 2000);
    } catch {
      // Pano izni yoksa sessizce geçiyoruz: kullanıcı değeri zaten
      // ekranda görüyor ve elle seçebilir.
    }
  }

  return (
    <button
      type="button"
      onClick={kopyala}
      aria-label={`${etiket} kopyala`}
      title={kopyalandi ? 'Kopyalandı' : `${etiket} kopyala`}
      className="shrink-0 rounded px-1.5 py-0.5 text-2xs text-fg-faint transition-colors hover:bg-surface-2 hover:text-fg"
    >
      {kopyalandi ? 'kopyalandı' : 'kopyala'}
    </button>
  );
}
