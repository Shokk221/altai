'use client';

import { cn } from '@/lib/cn';
import { useEffect, useRef, useState } from 'react';

/**
 * Sunucu geneli duyuru kutusu.
 *
 * Tek oyuncuya giden uyarı oyuncu satırındaki menüde; bu ayrı, çünkü ayrı
 * bir eylem: hedefi yok, o an sunucuda olan herkesin ekranına yazıyor.
 * Oyuncu menüsüne "herkese gönder" seçeneği koymak kısa yol olurdu ama
 * yanlış tıklamayla tek kişiye yazılacak şeyi herkese göndermek çok kolay
 * olurdu.
 *
 * Üst çubukta duruyor çünkü hedefi tek bir satır değil sunucunun kendisi.
 */

const SINIR = 200;

interface Sunucu {
  serverSlug: string;
  playerCount: number;
}

export function Duyuru({
  apiUrl,
  sunucular,
  yetki,
}: {
  apiUrl: string;
  sunucular: Sunucu[];
  yetki: boolean;
}) {
  const [acik, setAcik] = useState(false);
  const [mesaj, setMesaj] = useState('');
  const [slug, setSlug] = useState<string | null>(null);
  const [bekliyor, setBekliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [gitti, setGitti] = useState(false);
  const kutu = useRef<HTMLDivElement | null>(null);
  const alan = useRef<HTMLTextAreaElement | null>(null);

  // Hedef sunucu: seçim yapılmadıysa listedeki ilki. Seçili sunucu
  // listeden düşerse (agent koptu) seçim de düşüyor — kopuk bir slug'a
  // göndermeye çalışmak 503 ile biterdi.
  const secili = sunucular.find((s) => s.serverSlug === slug) ?? sunucular[0] ?? null;

  useEffect(() => {
    if (!acik) return;
    alan.current?.focus();
    const tus = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAcik(false);
    };
    const disari = (e: MouseEvent) => {
      if (kutu.current && !kutu.current.contains(e.target as Node)) setAcik(false);
    };
    document.addEventListener('keydown', tus);
    document.addEventListener('mousedown', disari);
    return () => {
      document.removeEventListener('keydown', tus);
      document.removeEventListener('mousedown', disari);
    };
  }, [acik]);

  if (!yetki) return null;

  const metin = mesaj.trim();
  const gonderilebilir = metin.length > 0 && metin.length <= SINIR && !bekliyor && secili !== null;

  async function gonder() {
    if (!secili || !gonderilebilir) return;
    setBekliyor(true);
    setHata(null);
    try {
      const res = await fetch(`${apiUrl}/live/${secili.serverSlug}/duyuru`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mesaj: metin }),
      });
      const govde = (await res.json().catch(() => ({}))) as { error?: string; detay?: string };
      if (!res.ok) {
        // Üç ayrı başarısızlık üç ayrı şey demek ve yetkilinin ne
        // yapacağı farklı: yetki yoksa bekleyecek bir şey yok, agent
        // kopuksa geri gelmesini bekler, komut başarısızsa tekrar dener.
        setHata(
          govde.error === 'agent_bagli_degil'
            ? 'Sunucuya bağlı değiliz, duyuru gitmedi'
            : govde.error === 'komut_basarisiz'
              ? `Komut sunucuya ulaşmadı (${govde.detay ?? '?'})`
              : govde.error === 'forbidden'
                ? 'Duyuru yapma yetkin yok'
                : (govde.detay ?? govde.error ?? 'Gönderilemedi'),
        );
        return;
      }
      // Kutu KAPANMIYOR: art arda duyuru yapmak yaygın (önce uyarı, sonra
      // "5 dk kaldı"). Onay iki saniye görünüp sönüyor.
      setMesaj('');
      setGitti(true);
      setTimeout(() => setGitti(false), 2000);
    } catch {
      setHata('Sunucuya ulaşılamadı');
    } finally {
      setBekliyor(false);
    }
  }

  return (
    <div ref={kutu} className="relative">
      <button
        type="button"
        onClick={() => setAcik((o) => !o)}
        disabled={sunucular.length === 0}
        className={cn(
          'rounded-full border px-2.5 py-1 text-2xs font-semibold transition-colors',
          'disabled:pointer-events-none disabled:opacity-40',
          acik
            ? 'border-accent-line bg-accent-weak text-accent'
            : 'border-border-strong text-fg-muted hover:text-fg',
        )}
        title="Sunucudaki herkese duyuru gönder"
      >
        duyuru
      </button>

      {acik ? (
        <div className="absolute left-0 top-7 z-40 w-80 origin-top-left animate-pop-in rounded border border-border-strong bg-surface p-3 shadow-lift">
          <p className="text-2xs text-fg-faint">
            {/* Kaç kişinin göreceği yazıyor: "herkese gidiyor" soyut, "43
                kişi görecek" değil. */}
            Sunucudaki herkesin ekranına yazılır
            {secili ? ` · ${secili.playerCount} kişi görecek` : ''}
          </p>

          {sunucular.length > 1 ? (
            // Tek sunucuda seçici gereksiz gürültü; birden fazlaysa
            // ZORUNLU — duyuruyu yanlış sunucuya göndermek geri alınamaz.
            <div className="mt-2 flex flex-wrap gap-1">
              {sunucular.map((s) => (
                <button
                  key={s.serverSlug}
                  type="button"
                  onClick={() => setSlug(s.serverSlug)}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-2xs transition-colors',
                    s.serverSlug === secili?.serverSlug
                      ? 'bg-accent-weak text-accent'
                      : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {s.serverSlug}
                </button>
              ))}
            </div>
          ) : null}

          <textarea
            ref={alan}
            value={mesaj}
            onChange={(e) => setMesaj(e.target.value)}
            onKeyDown={(e) => {
              // Enter yeni satır AÇMIYOR ama tek başına da göndermiyor:
              // Squad duyuruyu tek satır gösteriyor, satır sonu zaten
              // agent tarafında temizleniyor. Ctrl+Enter bilinçli bir
              // hareket, kazara basılmaz.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (e.ctrlKey || e.metaKey) void gonder();
              }
            }}
            rows={3}
            maxLength={SINIR * 2}
            placeholder="Duyuru metni"
            className="mt-2 w-full resize-none rounded-sm border border-border-strong bg-surface-sunken px-2.5 py-1.5 text-footnote text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
          />

          <div className="mt-1 flex items-center justify-between">
            {/* Sayaç sınıra yaklaşınca renk değiştiriyor: uç 200'ü aşan
                metni reddediyor ve bunu göndermeden önce bilmek gerek. */}
            <span
              className={cn('num text-2xs', metin.length > SINIR ? 'text-danger' : 'text-fg-faint')}
            >
              {metin.length}/{SINIR}
            </span>
            <div className="flex items-center gap-2">
              {gitti ? <span className="text-2xs text-success">gönderildi</span> : null}
              <button
                type="button"
                onClick={() => void gonder()}
                disabled={!gonderilebilir}
                className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-ink-fg disabled:opacity-40"
              >
                {bekliyor ? '…' : 'Gönder'}
              </button>
            </div>
          </div>

          {hata ? <p className="mt-1.5 text-xs text-danger">{hata}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
