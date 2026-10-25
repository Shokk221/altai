'use client';

import type { Kural } from '@/components/kurallar';
import { bolumlereAyir, kuralAra, kuralKodu, kuralOzeti } from '@/components/oyuncu/kural';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/lib/cn';
import { banSebebi } from '@/lib/format';
import { useMemo, useState } from 'react';

/**
 * Ban penceresi.
 *
 * ÜÇ KARAR:
 *
 *  1. KURAL SEÇMEK ZORUNLU. Önce ban sebebi serbest metindi ve her
 *     yetkili kendi cümlesini yazıyordu: "tk", "TK yaptı", "takım
 *     arkadaşını öldürdü", "team kill" — aynı ihlal dört farklı kayıtla
 *     duruyordu. İtiraz geldiğinde hangi kurala dayandığı belirsizdi.
 *     Artık ban bir kurala bağlanmadan atılamıyor.
 *
 *  2. OYUNCUYA KOD VE AÇIKLAMA GİDİYOR. Oyuncunun oyunda gördüğü mesaj
 *     `GEN-3 · Kasıtlı olarak takım arkadaşını öldürmek yasaktır.`
 *     biçiminde: kodu talep açarken söylüyor, açıklama da neden
 *     atıldığını anlatıyor. Kodlar altaisquad.com/kurallar'daki
 *     kodların aynısı, yani oyuncunun zaten bildiği şey.
 *
 *  3. ÖNİZLEME CANLI. Yetkili gönderdiği şeyi göndermeden önce
 *     görüyor, bitiş tarihi hesaplanmış hâliyle. Ban mesajı oyuncunun
 *     gördüğü TEK şey; körlemesine yazılmamalı.
 *
 * 52 KURAL VAR. Hepsini açık liste olarak basmak pencereyi taranamaz
 * yapıyordu: arama kutusu ve bölüm başlıkları o yüzden var, ve kuralın
 * tam metni yalnızca SEÇİLİ olanda açılıyor. Yetkili genelde ne
 * aradığını biliyor ("tk", "kamikaze", "SL-12").
 *
 * İç not ve delil alanları api'de zaten vardı ama panel hiç
 * göndermiyordu; buraya kondu.
 */

/** Hazır süreler — en sık kullanılanlar. Elle gün yazmak da mümkün. */
const SURELER = [
  { gun: 1, etiket: '1 gün' },
  { gun: 3, etiket: '3 gün' },
  { gun: 7, etiket: '7 gün' },
  { gun: 14, etiket: '14 gün' },
  { gun: 30, etiket: '30 gün' },
  { gun: 0, etiket: 'Kalıcı' },
] as const;

/** Oyuncunun oyunda göreceği metin (yer tutucu hâliyle kaydedilen). */
export function banMetni(kural: Kural | null, detay: string, kalici: boolean): string {
  const parcalar: string[] = [];
  if (kural) parcalar.push(`${kuralKodu(kural)} · ${kuralOzeti(kural)}`);
  const d = detay.trim();
  if (d) parcalar.push(d);
  // `{{expires}}` ban listesi üretilirken dolduruluyor (bkz.
  // lib/format.ts banSebebi ve routes/ban-list.ts). Kalıcı banda bitiş
  // yazmanın anlamı yok.
  parcalar.push(kalici ? 'Kalıcı' : 'Bitiş: {{expires}}');
  return parcalar.join(' · ');
}

export function BanPenceresi({
  acik,
  onKapat,
  onGonder,
  kurallar,
  oyuncuAdi,
  bekliyor,
  hata,
}: {
  acik: boolean;
  onKapat: () => void;
  onGonder: (veri: {
    reason: string;
    expiresAt: string | null;
    internalNote: string | null;
    evidence: string | null;
  }) => void;
  kurallar: Kural[];
  oyuncuAdi: string;
  bekliyor: boolean;
  hata: string | null;
}) {
  const [kuralId, setKuralId] = useState<string | null>(null);
  const [arama, setArama] = useState('');
  const [gun, setGun] = useState<number>(7);
  const [elleGun, setElleGun] = useState('');
  const [detay, setDetay] = useState('');
  const [icNot, setIcNot] = useState('');
  const [delil, setDelil] = useState('');

  // Yalnızca AKTİF kurallar seçilebiliyor: kaldırılmış bir kurala
  // dayanarak ban atmak, itirazda savunulamaz.
  const aktif = useMemo(() => kurallar.filter((k) => k.active !== false), [kurallar]);
  const bulunan = useMemo(() => kuralAra(aktif, arama), [aktif, arama]);
  const bolumler = useMemo(() => bolumlereAyir(bulunan), [bulunan]);
  const secili = aktif.find((k) => k.id === kuralId) ?? null;

  const etkinGun = elleGun.trim() ? Number(elleGun) : gun;
  const kalici = etkinGun === 0;

  // KAYDEDİLEN metin: `{{expires}}` yer tutucusu duruyor.
  const kaydedilecek = banMetni(secili, detay, kalici);
  const bitis = kalici
    ? null
    : new Date(Date.now() + Math.max(1, etkinGun) * 86_400_000).toISOString();
  // GÖSTERİLEN metin: yer tutucu dolu. "Oyuncu şunu görecek" diyorsak
  // gerçekten göreceği şeyi basmalıyız.
  const onizleme = banSebebi(kaydedilecek, bitis);
  // api sebebi 500 karakterle sınırlıyor; sınır KAYDEDİLEN metne.
  const cokUzun = kaydedilecek.length > 500;
  const gonderilebilir = secili !== null && !cokUzun && !bekliyor;

  function gonder() {
    if (!secili || cokUzun) return;
    onGonder({
      reason: kaydedilecek,
      expiresAt: bitis,
      internalNote: icNot.trim() || null,
      evidence: delil.trim() || null,
    });
  }

  return (
    <Modal
      acik={acik}
      onKapat={onKapat}
      genislik="lg"
      baslik={`${oyuncuAdi} için ban`}
      aciklama="Ban bir kurala dayanmak zorunda. Oyuncu aşağıdaki metni görecek."
      altBilgi={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {hata ? <span className="mr-auto text-xs font-medium text-danger">{hata}</span> : null}
          <Button variant="ghost" size="sm" onClick={onKapat} disabled={bekliyor}>
            Vazgeç
          </Button>
          <Button variant="danger" size="sm" onClick={gonder} disabled={!gonderilebilir}>
            {bekliyor ? 'Banlanıyor…' : kalici ? 'Kalıcı banla' : `${etkinGun} gün banla`}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {/* ---------------------------------------------- kural */}
        <section>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-footnote font-semibold">
              Hangi kural ihlal edildi?
              <span className="ml-1.5 font-normal text-danger">zorunlu</span>
            </h3>
            <span className="num text-2xs text-fg-faint">{aktif.length} kural</span>
          </div>

          {aktif.length === 0 ? (
            <p className="mt-2 rounded-sm border border-warn-line px-3 py-2 text-xs text-warn">
              Tanımlı kural yok. Kurallar ekranından kural eklemeden ban atılamaz.
            </p>
          ) : (
            <>
              <Input
                value={arama}
                onChange={(e) => setArama(e.target.value)}
                placeholder="Kural ara: kod, kelime ya da bölüm"
                aria-label="Kural ara"
                className="mt-2"
              />

              {bulunan.length === 0 ? (
                <p className="mt-2 rounded-sm border border-border bg-surface-sunken px-3 py-2.5 text-xs text-fg-muted">
                  "{arama}" ile eşleşen kural yok.
                </p>
              ) : (
                // Liste kendi içinde kayıyor: 52 kural pencerenin
                // tamamını yemesin, süre ve önizleme görünür kalsın.
                <div className="mt-2 max-h-72 overflow-y-auto rounded-sm border border-border">
                  {bolumler.map((b) => (
                    <div key={b.bolum}>
                      <h4 className="sticky top-0 z-10 bg-surface-2 px-3 py-1.5 text-2xs font-medium text-fg-muted">
                        {b.bolum}
                      </h4>
                      <ul>
                        {b.kurallar.map((k) => {
                          const bu = k.id === kuralId;
                          return (
                            <li key={k.id} className="border-b border-border last:border-0">
                              <button
                                type="button"
                                onClick={() => setKuralId(k.id)}
                                aria-pressed={bu}
                                className={cn(
                                  'w-full px-3 py-2 text-left transition-colors',
                                  bu ? 'bg-accent-weak' : 'hover:bg-surface-2',
                                )}
                              >
                                <span className="flex items-baseline gap-2">
                                  <span
                                    className={cn(
                                      'num w-20 shrink-0 text-2xs font-semibold',
                                      bu ? 'text-accent-2' : 'text-fg-faint',
                                    )}
                                  >
                                    {kuralKodu(k)}
                                  </span>
                                  <span className="min-w-0 flex-1 text-footnote leading-snug">
                                    {kuralOzeti(k)}
                                  </span>
                                </span>
                                {/* Tam metin YALNIZCA seçilide: 52
                                    kuralın tamamını açmak listeyi
                                    taranamaz yapıyordu. */}
                                {bu && k.body.trim() !== kuralOzeti(k) ? (
                                  <span className="mt-1.5 block whitespace-pre-line border-l-2 border-accent-line pl-2.5 text-2xs leading-relaxed text-fg-muted">
                                    {k.body}
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>

        {/* ---------------------------------------------- süre */}
        <section>
          <h3 className="text-footnote font-semibold">Süre</h3>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {SURELER.map((s) => {
              const bu = !elleGun.trim() && gun === s.gun;
              return (
                <button
                  key={s.gun}
                  type="button"
                  onClick={() => {
                    setGun(s.gun);
                    setElleGun('');
                  }}
                  aria-pressed={bu}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    bu
                      ? 'border-accent bg-accent-weak text-accent-2'
                      : 'border-border text-fg-muted hover:border-border-strong hover:text-fg',
                  )}
                >
                  {s.etiket}
                </button>
              );
            })}
            <Input
              value={elleGun}
              onChange={(e) => setElleGun(e.target.value.replace(/\D/g, ''))}
              placeholder="başka gün"
              inputMode="numeric"
              aria-label="Gün olarak süre"
              className="ml-1 w-28"
            />
          </div>
        </section>

        {/* ---------------------------------------------- detay */}
        <section>
          <h3 className="text-footnote font-semibold">
            Ek açıklama <span className="font-normal text-fg-faint">isteğe bağlı</span>
          </h3>
          <p className="mt-1 text-2xs text-fg-faint">
            Oyuncu bunu da görecek. Olayın kendisi: "mangayı dağıttı", "üçüncü kez".
          </p>
          <Input
            value={detay}
            onChange={(e) => setDetay(e.target.value)}
            placeholder="Kısa ve olaya özgü"
            className="mt-2"
          />
        </section>

        {/* ---------------------------------------------- önizleme */}
        <section>
          <h3 className="text-footnote font-semibold">Oyuncu şunu görecek</h3>
          <p
            className={cn(
              'mt-2 rounded-sm border px-3 py-2.5 text-footnote leading-relaxed',
              cokUzun ? 'border-danger-weak text-danger' : 'border-border bg-surface-sunken',
            )}
          >
            {secili ? onizleme : 'Önce bir kural seçin.'}
          </p>
          {cokUzun ? (
            <p className="mt-1 text-2xs text-danger">
              Çok uzun ({kaydedilecek.length}/500). Ek açıklamayı kısaltın.
            </p>
          ) : null}
        </section>

        {/* ------------------------------------- yalnızca yetkililer */}
        <section className="border-t border-border pt-4">
          <h3 className="text-footnote font-semibold">
            Yalnızca yetkililer görür{' '}
            <span className="font-normal text-fg-faint">isteğe bağlı</span>
          </h3>
          <div className="mt-2 flex flex-col gap-2">
            <Input
              value={icNot}
              onChange={(e) => setIcNot(e.target.value)}
              placeholder="İç not: karar gerekçesi, geçmiş uyarılar"
              aria-label="İç not"
            />
            <Input
              value={delil}
              onChange={(e) => setDelil(e.target.value)}
              placeholder="Delil: kayıt bağlantısı, ekran görüntüsü, saat"
              aria-label="Delil"
            />
          </div>
        </section>
      </div>
    </Modal>
  );
}
