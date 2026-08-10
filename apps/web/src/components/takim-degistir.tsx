'use client';

import { cn } from '@/lib/cn';
import { useEffect, useRef, useState } from 'react';

/**
 * Takım değiştirme onayı.
 *
 * Üç giriş noktası da (oyuncuyu sürükle, mangayı sürükle, menüden seç)
 * buraya geliyor — karar aynı karar, sorulması gereken şey aynı: ne zaman
 * ve oyuncuya ne denecek.
 *
 * Onay adımı ATLANMIYOR. Sürükleyip bırakmak kolay ve yanlışlıkla olur;
 * dokuz kişilik bir mangayı kazara karşıya atmak maçı bozar ve geri
 * alması da (komut hedef takım almadığı için) ikinci bir müdahale ister.
 */

export type Zaman = 'simdi' | 'mac_sonu';

export interface Aday {
  steamId: string;
  name: string;
  /** Şu anki takımı; kaçının gerçekten taşınacağını göstermek için. */
  takim?: 1 | 2;
}

export interface Istek {
  /** Taşınacak oyuncular. Manga sürüklendiğinde hepsi burada. */
  adaylar: Aday[];
  /** Ekranda "X mangası" gibi bir başlık gösterilecekse. */
  baslik?: string;
  /**
   * Oyuncuların VARMASI istenen takım.
   *
   * "Karşıya çevir" değil: seçim iki taraftan da olabiliyor ve hepsi bu
   * takımda toplanıyor. Zaten orada olanlara komut gönderilmiyor.
   */
  hedefTakim: 1 | 2;
}

export function TakimDegistirKutusu({
  apiUrl,
  slug,
  istek,
  kapat,
}: {
  apiUrl: string;
  slug: string;
  istek: Istek;
  kapat: () => void;
}) {
  const [zaman, setZaman] = useState<Zaman>('simdi');
  const [mesaj, setMesaj] = useState('');
  const [bekliyor, setBekliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const kutu = useRef<HTMLDivElement | null>(null);

  // Escape ile kapanmalı: sürükleyip bıraktıktan sonra "yanlış oldu"
  // diyen kişinin ilk refleksi bu tuş.
  useEffect(() => {
    const tus = (e: KeyboardEvent) => {
      if (e.key === 'Escape') kapat();
    };
    document.addEventListener('keydown', tus);
    return () => document.removeEventListener('keydown', tus);
  }, [kapat]);

  const hedefTakim = istek.hedefTakim;
  const cok = istek.adaylar.length > 1;
  // Takımı bilinmeyeni "taşınacak" sayıyoruz: uç zaten hedefte olana
  // komut göndermiyor, buradaki sayı yalnızca beklentiyi anlatıyor.
  const tasinacak = istek.adaylar.filter((a) => a.takim !== hedefTakim).length;
  const zatenOrada = istek.adaylar.length - tasinacak;

  async function gonder() {
    setBekliyor(true);
    setHata(null);
    try {
      const res = await fetch(`${apiUrl}/live/${slug}/takim`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          steamIds: istek.adaylar.map((a) => a.steamId),
          zaman,
          hedefTakim,
          ...(mesaj.trim() ? { mesaj: mesaj.trim() } : {}),
        }),
      });
      const govde = (await res.json().catch(() => ({}))) as {
        error?: string;
        detay?: string;
        basarisiz?: number;
        dogrulanamayan?: number;
      };
      if (!res.ok) {
        setHata(
          govde.error === 'agent_bagli_degil'
            ? 'Agent bağlı değil'
            : (govde.detay ?? govde.error ?? 'Başarısız'),
        );
        return;
      }
      // Kısmi başarı sessizce geçilmiyor: mangada birileri geçmediyse
      // yetkili bunu bilmeli, yoksa "yaptım" sanıp devam eder.
      if (govde.basarisiz && govde.basarisiz > 0) {
        setHata(`${govde.basarisiz} oyuncu geçirilemedi (çıkmış olabilir)`);
        return;
      }
      // Squad komutu kabul edip oyuncuyu taşımayabiliyor (kendi denge
      // kilidi). Sessizce "oldu" demek yanlış bilgi olurdu.
      if (govde.dogrulanamayan && govde.dogrulanamayan > 0) {
        setHata(
          `${govde.dogrulanamayan} oyuncu hâlâ eski takımında — Squad denge kilidi reddetmiş olabilir`,
        );
        return;
      }
      kapat();
    } catch {
      setHata('Sunucuya ulaşılamadı');
    } finally {
      setBekliyor(false);
    }
  }

  return (
    // Örtü: arkadaki listeye tıklamayı engelliyor ve odağı kutuya veriyor.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (!kutu.current?.contains(e.target as Node)) kapat();
      }}
    >
      <div
        ref={kutu}
        className="w-full max-w-sm rounded-lg border border-border-strong bg-surface p-4 shadow-lift"
      >
        <h2 className="text-[15px] font-semibold">Takım {hedefTakim}'e al</h2>
        <p className="mt-1 text-[13px] text-fg-muted">
          {istek.baslik ? `${istek.baslik} · ` : ''}
          {cok ? `${istek.adaylar.length} oyuncu` : istek.adaylar[0]?.name}
          {zatenOrada > 0 ? (
            // Sessizce atlanmıyor: "5 kişi seçtim ama 2'si taşındı"
            // sürprizi, önceden söylenmiş olmasından kötü.
            <span className="text-fg-faint"> · {zatenOrada}’i zaten bu takımda</span>
          ) : null}
        </p>

        {cok ? (
          <ul className="mt-2 max-h-28 overflow-y-auto rounded-sm bg-surface-sunken px-2.5 py-1.5 text-[12px]">
            {istek.adaylar.map((a) => (
              <li
                key={a.steamId}
                className={cn(
                  'truncate leading-[1.6]',
                  a.takim === hedefTakim ? 'text-fg-faint line-through' : 'text-fg-muted',
                )}
              >
                {a.name}
              </li>
            ))}
          </ul>
        ) : null}

        {/* İki seçenek yan yana: hangisinin seçili olduğu tek bakışta
            görünmeli, çünkü ikisinin sonucu tamamen farklı. */}
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-full bg-surface-sunken p-1">
          <Secenek etkin={zaman === 'simdi'} onClick={() => setZaman('simdi')}>
            Şimdi
          </Secenek>
          <Secenek etkin={zaman === 'mac_sonu'} onClick={() => setZaman('mac_sonu')}>
            Maç sonunda
          </Secenek>
        </div>

        <p className="mt-2 text-[11px] leading-relaxed text-fg-faint">
          {zaman === 'simdi'
            ? `Takım ${hedefTakim}'de olmayanlar hemen alınır; geçmeden önce uyarı görürler.`
            : 'Oyuncular şimdi uyarılır, geçiş maç bitince yapılır. O ana kadar iptal edilebilir.'}
        </p>

        <input
          value={mesaj}
          onChange={(e) => setMesaj(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !bekliyor) void gonder();
          }}
          placeholder="Sebep (isteğe bağlı) — oyuncuya gösterilir"
          className="mt-3 w-full rounded-sm border border-border-strong bg-surface-sunken px-2.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
        />

        {hata ? <p className="mt-2 text-[12px] text-danger">{hata}</p> : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={kapat}
            className="rounded-full px-3.5 py-1.5 text-[13px] text-fg-muted hover:text-fg"
          >
            Vazgeç
          </button>
          <button
            type="button"
            onClick={gonder}
            disabled={bekliyor}
            className="rounded-full bg-ink px-3.5 py-1.5 text-[13px] font-medium text-ink-fg disabled:opacity-40"
          >
            {bekliyor
              ? '…'
              : zaman === 'simdi'
                ? `Şimdi al${tasinacak > 1 ? ` (${tasinacak})` : ''}`
                : `Maç sonuna al${tasinacak > 1 ? ` (${tasinacak})` : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function Secenek({
  etkin,
  onClick,
  children,
}: {
  etkin: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full py-1.5 text-[13px] transition-colors',
        etkin ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}
