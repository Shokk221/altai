'use client';

import { cn } from '@/lib/cn';
import { useEffect, useRef, useState } from 'react';

/**
 * Harita kontrolü: sıradaki harita, haritayı şimdi değiştirme, maçı
 * yeniden başlatma.
 *
 * Üç eylemin ağırlığı çok farklı ve ekran bunu yansıtıyor:
 *   Sıradaki yap      — maçı etkilemiyor, ana eylem, tek tık.
 *   Şimdi değiştir    — maç O AN biter; ikinci bir onay ister.
 *   Maçı yeniden başlat — aynı; ayrıca listeden bağımsız, en altta.
 *
 * Harita adı listeden SEÇİLİYOR: elle yazılan bir yazım hatasıyla
 * "şimdi değiştir" maçı boşuna bitirirdi. Liste alınamazsa (eski agent,
 * Squad çıktısı değişmiş) elle yazmaya düşülüyor, biçim yine denetleniyor.
 */

interface Sunucu {
  serverSlug: string;
  playerCount: number;
  layer?: string;
}

interface Katman {
  level: string | null;
  layer: string | null;
}

interface Veri {
  bilgi: { simdiki: Katman; sonraki: Katman } | null;
  layers: string[] | null;
  hata: string | null;
}

/** Listede bir anda gösterilen en fazla satır; arama daraltıyor. */
const GORUNEN = 80;

/**
 * Katman adı biçimi — `@altai/contracts`'taki KATMAN_ADI'nin kopyası.
 *
 * Paketten içe aktarılmıyor: contracts derlenmemiş TypeScript olarak
 * paylaşılıyor ve Next tarayıcı paketinde onun `./x.js` importlarını
 * çözemiyor (derleme kırılmıştı). Burada yalnızca düğmeyi açıp kapatıyor;
 * asıl denetim api'de ve agent'ta, paketteki kalıpla.
 */
const KATMAN_ADI = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+$/;

const HATALAR: Record<string, string> = {
  agent_bagli_degil: 'Sunucuya bağlı değiliz',
  forbidden: 'Bu işlem için sunucu kontrolü izni gerekiyor',
  bilinmeyen_katman: 'Sunucu bu haritayı tanımıyor',
  zaman_asimi: 'Agent cevap vermedi. Agent güncel değilse harita özelliği çalışmaz.',
};

function hataMetni(g: { error?: string; detay?: string }): string {
  if (g.error === 'komut_basarisiz') {
    return HATALAR[g.detay ?? ''] ?? `Komut sunucuya ulaşmadı (${g.detay ?? '?'})`;
  }
  return HATALAR[g.error ?? ''] ?? g.detay ?? g.error ?? 'İşlem başarısız';
}

export function Harita({
  apiUrl,
  sunucular,
  yetki,
}: {
  apiUrl: string;
  sunucular: Sunucu[];
  yetki: boolean;
}) {
  const [acik, setAcik] = useState(false);
  const [slug, setSlug] = useState<string | null>(null);
  const [veri, setVeri] = useState<Veri | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);
  const [yenile, setYenile] = useState(0);
  const [arama, setArama] = useState('');
  const [secim, setSecim] = useState('');
  // İkinci onay bekleyen tehlikeli eylem.
  const [onay, setOnay] = useState<'simdi' | 'restart' | null>(null);
  const [bekliyor, setBekliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [bildirim, setBildirim] = useState<string | null>(null);
  const kutu = useRef<HTMLDivElement | null>(null);

  const secili = sunucular.find((s) => s.serverSlug === slug) ?? sunucular[0] ?? null;
  const seciliSlug = secili?.serverSlug ?? null;

  useEffect(() => {
    if (!acik) return;
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

  // Açılınca (ve bir eylemden sonra) bilgi tazeleniyor: sıradaki harita
  // eylemin kendisiyle değişiyor ve eski bilgiyle bırakılmamalı.
  useEffect(() => {
    if (!acik || !seciliSlug || yenile < 0) return;
    let iptal = false;
    setYukleniyor(true);
    fetch(`${apiUrl}/live/${seciliSlug}/harita`, { credentials: 'include' })
      .then(async (r) => {
        const g = await r.json().catch(() => ({}));
        if (iptal) return;
        if (!r.ok) {
          setVeri(null);
          setHata(hataMetni(g));
        } else {
          setVeri(g as Veri);
        }
      })
      .catch(() => !iptal && setHata('Sunucuya ulaşılamadı'))
      .finally(() => !iptal && setYukleniyor(false));
    return () => {
      iptal = true;
    };
  }, [acik, seciliSlug, apiUrl, yenile]);

  if (!yetki) return null;

  const liste = veri?.layers ?? null;
  const aranan = arama.trim().toLowerCase();
  const suzulen = liste ? liste.filter((l) => !aranan || l.toLowerCase().includes(aranan)) : [];
  const katman = secim.trim();
  const gecerli = liste ? liste.includes(katman) : KATMAN_ADI.test(katman);
  const simdiki = veri?.bilgi?.simdiki.layer ?? secili?.layer ?? null;
  const sonraki = veri?.bilgi?.sonraki.layer ?? null;

  async function gonder(yol: string, govde: unknown, basari: string) {
    if (!seciliSlug) return;
    setBekliyor(true);
    setHata(null);
    setBildirim(null);
    try {
      const res = await fetch(`${apiUrl}/live/${seciliSlug}/${yol}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(govde),
      });
      if (!res.ok) {
        setHata(hataMetni(await res.json().catch(() => ({}))));
        return;
      }
      setBildirim(basari);
      setOnay(null);
      setYenile((n) => n + 1);
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
        title="Sıradaki haritayı ayarla, haritayı değiştir, maçı yeniden başlat"
      >
        harita
      </button>

      {acik ? (
        <div className="absolute left-0 top-7 z-40 w-[22rem] max-w-[calc(100vw-2rem)] origin-top-left animate-pop-in rounded border border-border-strong bg-surface p-3 shadow-lift">
          {sunucular.length > 1 ? (
            <div className="mb-2 flex flex-wrap gap-1">
              {sunucular.map((s) => (
                <button
                  key={s.serverSlug}
                  type="button"
                  onClick={() => {
                    setSlug(s.serverSlug);
                    setSecim('');
                    setOnay(null);
                  }}
                  className={cn(
                    'rounded-full px-2 py-0.5 text-2xs transition-colors',
                    s.serverSlug === seciliSlug
                      ? 'bg-accent-weak text-accent'
                      : 'text-fg-muted hover:text-fg',
                  )}
                >
                  {s.serverSlug}
                </button>
              ))}
            </div>
          ) : null}

          <dl className="grid grid-cols-[4.5rem_1fr] gap-y-0.5 text-footnote">
            <dt className="text-fg-faint">Şu an</dt>
            <dd className="truncate font-medium text-fg">{simdiki ?? 'bilinmiyor'}</dd>
            <dt className="text-fg-faint">Sıradaki</dt>
            <dd className="truncate text-fg-muted">
              {yukleniyor && !veri ? '…' : (sonraki ?? 'oylamayla belirlenecek')}
            </dd>
          </dl>

          <div className="mt-3">
            {liste ? (
              <>
                <input
                  value={arama}
                  onChange={(e) => setArama(e.target.value)}
                  placeholder={`${liste.length} harita içinde ara`}
                  className="w-full rounded-sm border border-border-strong bg-surface-sunken px-2.5 py-1.5 text-footnote text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
                />
                <ul className="mt-1.5 max-h-48 overflow-y-auto rounded-sm bg-surface-sunken p-1">
                  {suzulen.slice(0, GORUNEN).map((l) => (
                    <li key={l}>
                      <button
                        type="button"
                        onClick={() => {
                          setSecim(l);
                          setOnay(null);
                        }}
                        className={cn(
                          'w-full truncate rounded-sm px-2 py-1 text-left font-mono text-2xs transition-colors',
                          l === katman
                            ? 'bg-accent-weak text-accent'
                            : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                        )}
                      >
                        {l}
                      </button>
                    </li>
                  ))}
                  {suzulen.length === 0 ? (
                    <li className="px-2 py-3 text-center text-2xs text-fg-faint">Eşleşen yok</li>
                  ) : null}
                  {suzulen.length > GORUNEN ? (
                    <li className="px-2 py-1 text-center text-2xs text-fg-faint">
                      {suzulen.length - GORUNEN} tane daha, aramayı daraltın
                    </li>
                  ) : null}
                </ul>
              </>
            ) : (
              <>
                <input
                  value={secim}
                  onChange={(e) => {
                    setSecim(e.target.value.replace(/[^A-Za-z0-9_]/g, ''));
                    setOnay(null);
                  }}
                  placeholder="Narva_RAAS_v1"
                  className="w-full rounded-sm border border-border-strong bg-surface-sunken px-2.5 py-1.5 font-mono text-footnote text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
                />
                <p className="mt-1 text-2xs text-fg-faint">
                  {yukleniyor
                    ? 'Harita listesi alınıyor…'
                    : 'Harita listesi alınamadı. Katman adını tam yazın.'}
                </p>
              </>
            )}
          </div>

          {onay === 'simdi' ? (
            <div className="mt-3 rounded-sm border border-warn-line bg-warn-weak p-2.5">
              <p className="text-footnote text-fg">
                Maç şimdi biter, {secili?.playerCount ?? 0} oyuncu <b>{katman}</b> haritasına geçer.
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={bekliyor}
                  onClick={() =>
                    void gonder(
                      'harita',
                      { layer: katman, zaman: 'simdi' },
                      `Harita ${katman} olarak değiştiriliyor`,
                    )
                  }
                  className="rounded-full bg-danger px-3 py-1 text-xs font-medium text-danger-fg disabled:opacity-40"
                >
                  {bekliyor ? '…' : 'Evet, şimdi değiştir'}
                </button>
                <button
                  type="button"
                  onClick={() => setOnay(null)}
                  className="rounded-full px-3 py-1 text-xs text-fg-muted hover:text-fg"
                >
                  Vazgeç
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!gecerli || bekliyor}
                onClick={() =>
                  void gonder(
                    'harita',
                    { layer: katman, zaman: 'sonraki' },
                    `Sıradaki harita: ${katman}`,
                  )
                }
                className="rounded-full bg-ink px-3 py-1 text-xs font-medium text-ink-fg disabled:opacity-40"
              >
                {bekliyor && onay === null ? '…' : 'Sıradaki yap'}
              </button>
              <button
                type="button"
                disabled={!gecerli || bekliyor}
                onClick={() => setOnay('simdi')}
                className="rounded-full px-3 py-1 text-xs text-danger transition-colors hover:bg-danger-weak disabled:opacity-40"
              >
                Şimdi değiştir
              </button>
            </div>
          )}

          <div className="mt-3 border-t border-border pt-2.5">
            {onay === 'restart' ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-footnote text-fg">Maç baştan başlasın mı?</span>
                <button
                  type="button"
                  disabled={bekliyor}
                  onClick={() => void gonder('mac-yeniden', {}, 'Maç yeniden başlatılıyor')}
                  className="rounded-full bg-danger px-3 py-1 text-xs font-medium text-danger-fg disabled:opacity-40"
                >
                  {bekliyor ? '…' : 'Evet'}
                </button>
                <button
                  type="button"
                  onClick={() => setOnay(null)}
                  className="rounded-full px-3 py-1 text-xs text-fg-muted hover:text-fg"
                >
                  Vazgeç
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setOnay('restart')}
                className="text-2xs text-fg-muted transition-colors hover:text-danger"
              >
                Maçı yeniden başlat
              </button>
            )}
          </div>

          {bildirim ? <p className="mt-2 text-2xs text-success">{bildirim}</p> : null}
          {hata ? <p className="mt-2 text-xs text-danger">{hata}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
