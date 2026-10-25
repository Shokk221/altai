import { ChatPanel } from '@/components/chat-panel';
import { CoplayPanel } from '@/components/coplay-panel';
import { FlagPicker } from '@/components/flag-picker';
import type { Kural } from '@/components/kurallar';
import { Kopyala } from '@/components/oyuncu/kopyala';
import { sicilOzeti } from '@/components/oyuncu/sicil';
import type { Profil, Yetkiler } from '@/components/oyuncu/tipler';
import {
  BanKaldir,
  BmTazele,
  EtiketKaldir,
  HizliEylemler,
  KaydiKapat,
} from '@/components/player-actions';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { banBitis, banSebebi, gecenSure, sayi, sure, tarih, tarihSaat } from '@/lib/format';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Oyuncu profili.
 *
 * YAPI BATTLEMETRICS'TEN ALINDI, bilinçli olarak. Yetkililer yıllardır
 * BM'nin oyuncu sayfasında çalışıyor ve nerede ne olduğunu refleksle
 * biliyor: solda katlanabilir bölümler, sağda sürekli akan olay
 * listesi. Bu kas hafızasını bozmanın bir bedeli var ve karşılığında
 * ne kazanıldığı belli değildi.
 *
 * ÖNCESİ: künye bandında dokuz istatistik yan yana, altında dört
 * sütunlu ızgara (kimlikler | banlar | kayıtlar+coplay | sohbet).
 * 1440 pikselde her sütun 330 piksele düşüyordu: ban sebepleri dört
 * satıra sarıyor, sohbet okunmuyor, 17 haneli kimlikler kırpılıyordu.
 * Dört ayrı kaydırma alanı vardı ve bir banla o gün yazılan mesajı
 * aynı anda görmek iki paneli ayrı ayrı kaydırmayı gerektiriyordu.
 *
 * NE MODERNLEŞİYOR:
 *  - 11 piksel sıkışık metin yerine okunur ölçek ve nefes alan satır
 *    aralığı;
 *  - her yerde varsayılan mavi bağlantı yerine mürekkep metin, mavi
 *    yalnızca gerçek eylemde;
 *  - satır sonlarındaki kaba renk çubukları yerine kanalın solunda
 *    küçük nokta;
 *  - bölümler KATLANIYOR (BM'de de öyle) ama hangisinin açık
 *    geleceği karara göre seçili: ban ve kayıtlar açık, kimlikler ve
 *    süre kapalı — çünkü ilk bakılan şey sicil;
 *  - sayfanın ortasında sürekli açık duran dev not formu, tek
 *    satırlık bir eylem çubuğuna indi (BM'de o form her zaman açık ve
 *    sayfanın yarısını yiyor).
 *
 * SAĞ SÜTUN BM'deki Activity Log'un karşılığı: bizde sohbet. Sayfayla
 * birlikte kaymıyor, kendi içinde kayıyor ve ekran boyunca duruyor.
 */
export function OyuncuProfili({
  profil,
  yetkiler,
  apiUrl,
  kurallar,
}: {
  profil: Profil;
  yetkiler: Yetkiler;
  apiUrl: string;
  /**
   * Sunucunun kuralları — ban penceresi bunlardan birini seçmeye
   * zorluyor. Sayfa bunu `/rules` ucundan çekiyor.
   */
  kurallar: Kural[];
}) {
  const { player, oyun } = profil;
  /**
   * BM aynası yoksa boş ayna.
   *
   * api'nin eski bir sürümü bu alanı hiç döndürmüyor. Her kullanım
   * yerinde `?.` yazmak yerine tek bir varsayılan: ekran "ayna kapalı"
   * durumunu zaten çizebiliyor ve o durumla aynı şey.
   */
  const bm = profil.bm ?? {
    acik: false,
    bmPlayerId: null,
    syncedAt: null,
    status: null,
    erisilemeyen: [],
    sunucular: [],
    banlar: [],
  };
  const ozet = sicilOzeti(profil);
  const aktifBan = profil.bans.find((b) => b.active);
  const aktifEtiketler = profil.flags.filter((f) => !f.removedAt);
  const acikKayit = profil.records.filter((k) => !k.resolvedAt);
  const kd = oyun.olum > 0 ? (oyun.kill / oyun.olum).toFixed(2) : String(oyun.kill);
  const bmSaniye = bm.sunucular.reduce((t, s) => t + (s.timePlayed ?? 0), 0);

  const kimlikler = [
    ...(player.steamId ? [{ deger: player.steamId, tur: 'Steam ID', zaman: oyun.sonGorulme }] : []),
    ...(player.eosId ? [{ deger: player.eosId, tur: 'EOS ID', zaman: oyun.sonGorulme }] : []),
    ...(player.battlemetricsId
      ? [{ deger: player.battlemetricsId, tur: 'BattleMetrics ID', zaman: bm.syncedAt }]
      : []),
    ...profil.names.map((n) => ({ deger: n.name, tur: 'İsim', zaman: n.lastSeen })),
  ];

  return (
    <main className="mx-auto w-full max-w-[100rem] px-5 py-4">
      <Link href="/oyuncular" className="text-xs font-semibold text-fg-muted hover:text-fg">
        ← Oyuncular
      </Link>

      {/* ---------------------------------------------------- künye */}
      <header className="mt-3 rounded border border-border bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="display text-2xl sm:text-3xl">{player.name}</h1>
              {aktifBan ? <Badge tone="danger">Banlı</Badge> : null}
              {aktifEtiketler.map((f) => (
                <span key={f.id} className="inline-flex items-center gap-1">
                  <Badge tone="info">{f.name}</Badge>
                  {yetkiler.etiketYonetir ? <EtiketKaldir apiUrl={apiUrl} atamaId={f.id} /> : null}
                </span>
              ))}
              {yetkiler.etiketYonetir ? (
                <FlagPicker
                  apiUrl={apiUrl}
                  playerId={player.id}
                  atanmisIdler={aktifEtiketler.map((f) => f.flagId)}
                />
              ) : null}
            </div>
            <p
              className={cn(
                'mt-2 text-sm',
                ozet.ton === 'danger'
                  ? 'text-danger'
                  : ozet.ton === 'warn'
                    ? 'text-warn'
                    : 'text-fg-muted',
              )}
            >
              {ozet.metin}
            </p>
          </div>

          {/* BM'deki sağ üst sayaçların karşılığı: ban / etiket / açık
              kayıt. Orada ikon ve rakam vardı, burada etiketli. */}
          <div className="flex shrink-0 items-end gap-5">
            <Sayac etiket="ban" deger={profil.bans.length} vurgu={!!aktifBan} />
            <Sayac etiket="etiket" deger={aktifEtiketler.length} />
            <Sayac etiket="açık kayıt" deger={acikKayit.length} vurgu={acikKayit.length > 0} />
          </div>
        </div>

        {yetkiler.banlayabilir || yetkiler.notYazabilir ? (
          <div className="border-t border-border px-5 py-3">
            <HizliEylemler
              apiUrl={apiUrl}
              playerId={player.id}
              playerAdi={player.name}
              kurallar={kurallar}
              banlayabilir={yetkiler.banlayabilir}
              notYazabilir={yetkiler.notYazabilir}
            />
          </div>
        ) : null}
      </header>

      {/* ------------------------------------------- iki sütun */}
      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        {/* ====== SOL: BM'deki bölüm sırası ====== */}
        <div className="flex min-w-0 flex-col gap-3">
          {/* --- Banlar: BM'de "Current & Past bans" --- */}
          <Bolum baslik="Banlar" sayac={profil.bans.length + bm.banlar.length} acik>
            {profil.bans.length === 0 && bm.banlar.length === 0 ? (
              <Bos metin="Ban kaydı yok." />
            ) : (
              <ul className="flex flex-col gap-2">
                {profil.bans.map((b) => (
                  <li
                    key={b.id}
                    className={cn(
                      'rounded-sm border bg-surface-sunken px-3 py-2.5',
                      b.active ? 'border-danger-weak' : 'border-border',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {b.active ? (
                        <Badge tone="danger">aktif</Badge>
                      ) : (
                        <Badge tone="neutral">{b.revokedAt ? 'kaldırıldı' : 'doldu'}</Badge>
                      )}
                      <span className="num text-2xs text-fg-faint">
                        {tarih(b.createdAt)} → {banBitis(b.expiresAt)}
                      </span>
                      <span className="ml-auto text-2xs text-fg-faint">
                        {b.issuedByName ?? 'bilinmiyor'}
                        {b.source !== 'altai' ? ` · ${b.source}` : ''}
                      </span>
                    </div>
                    <p className="mt-1.5 text-footnote leading-snug">
                      {banSebebi(b.reason, b.expiresAt)}
                    </p>
                    {b.internalNote ? (
                      <p className="mt-1.5 border-l-2 border-border pl-2.5 text-2xs leading-relaxed text-fg-muted">
                        {b.internalNote}
                      </p>
                    ) : null}
                    {b.active && yetkiler.banlayabilir ? (
                      <div className="mt-2.5">
                        <BanKaldir apiUrl={apiUrl} banId={b.id} />
                      </div>
                    ) : null}
                  </li>
                ))}

                {/* BM banları aynı listede ama kesikli kenarla: başka
                    sunucuda verilmişler, bizde uygulanmıyorlar. */}
                {bm.banlar.map((b) => (
                  <li
                    key={b.id}
                    className="rounded-sm border border-dashed border-border px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="neutral">BM</Badge>
                      <span className="num text-2xs text-fg-faint">
                        {tarih(b.issuedAt)} → {banBitis(b.expiresAt)}
                      </span>
                      <span className="ml-auto text-2xs text-fg-faint">
                        bizim sunucumuzda uygulanmıyor
                      </span>
                    </div>
                    <p className="mt-1.5 text-footnote leading-snug">{b.reason}</p>
                    {b.note ? (
                      <p className="mt-1 whitespace-pre-wrap text-2xs text-fg-muted">{b.note}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {bm.erisilemeyen.includes('banlar') ? (
              <p className="mt-2 rounded border border-warn-line px-3 py-2 text-2xs text-warn">
                BM ban listesi okunamadı; bu liste eksik olabilir.
              </p>
            ) : null}
          </Bolum>

          {/* --- Kayıtlar: BM'de "Admin Log" + "Notes" --- */}
          <Bolum baslik="Kayıtlar" sayac={profil.records.length} acik>
            {profil.records.length === 0 ? (
              <Bos metin="Not, uyarı ya da takip kaydı yok." />
            ) : (
              <ul className="flex flex-col gap-2">
                {profil.records.map((k) => (
                  <li
                    key={k.id}
                    className={cn(
                      'rounded-sm border border-border bg-surface-sunken px-3 py-2.5',
                      k.resolvedAt ? 'opacity-70' : '',
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={
                          k.kind === 'warning'
                            ? 'accent'
                            : k.kind === 'watchlist'
                              ? 'info'
                              : 'neutral'
                        }
                      >
                        {KAYIT_ETIKET[k.kind]}
                      </Badge>
                      {k.resolvedAt ? <Badge tone="neutral">kapatıldı</Badge> : null}
                      <span className="num text-2xs text-fg-faint">{tarihSaat(k.createdAt)}</span>
                      <span className="ml-auto flex items-center gap-3">
                        <span className="text-2xs text-fg-faint">
                          {k.authorName ?? 'bilinmiyor'}
                        </span>
                        {!k.resolvedAt && yetkiler.notYazabilir ? (
                          <KaydiKapat apiUrl={apiUrl} recordId={k.id} />
                        ) : null}
                      </span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap text-footnote leading-snug">
                      {k.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Bolum>

          {/* --- Kimlikler: BM'de "Identifiers", en üstteydi ---
              Burada ban ve kayıtların ALTINDA ve KAPALI: BM'de en üstte
              çünkü orada sayfa kimlik eşleştirme aracı olarak da
              kullanılıyor; bizde ilk soru "ne yapmalıyım". Kopyalama
              düğmesi korundu, en çok kullanılan şey o. */}
          <Bolum baslik="Kimlikler" sayac={kimlikler.length}>
            {kimlikler.length === 0 ? (
              <Bos metin="Kimlik kaydı yok." />
            ) : (
              <table className="w-full text-footnote">
                <thead>
                  <tr className="text-2xs text-fg-faint">
                    <th className="pb-2 text-left font-normal">Kimlik</th>
                    <th className="pb-2 text-left font-normal">Tür</th>
                    <th className="pb-2 text-right font-normal">Son görülme</th>
                    <th className="pb-2" />
                  </tr>
                </thead>
                <tbody>
                  {kimlikler.map((k) => (
                    <tr key={`${k.tur}:${k.deger}`} className="border-t border-border">
                      <td className="py-2 pr-3">
                        <span
                          className={cn(
                            'block truncate',
                            k.tur === 'İsim' ? '' : 'font-mono text-xs',
                          )}
                        >
                          {k.deger}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-xs text-fg-muted">{k.tur}</td>
                      <td className="py-2 text-right">
                        <span className="num block text-xs text-fg-muted">{tarih(k.zaman)}</span>
                        <span className="block text-2xs text-fg-faint">{gecenSure(k.zaman)}</span>
                      </td>
                      <td className="py-2 pl-2 text-right">
                        <Kopyala deger={k.deger} etiket={k.tur} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Bolum>

          {/* --- Oynama süresi: BM'de "Time Played" ağacı --- */}
          <Bolum baslik="Oynama süresi">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
              <Satir ad="Toplam" deger={sure(oyun.toplamSaniye)} />
              <Satir ad="Oturum" deger={sayi(oyun.oturum)} />
              <Satir ad="Maç" deger={sayi(oyun.mac)} />
              <Satir ad="K / D" deger={kd} />
              <Satir ad="Öldürme" deger={sayi(oyun.kill)} />
              <Satir ad="Ölüm" deger={sayi(oyun.olum)} />
              <Satir ad="Canlandırma" deger={sayi(oyun.revive)} />
              <Satir ad="Takım öldürme" deger={sayi(oyun.tk)} />
              {oyun.enUzunSeri > 0 ? (
                <Satir ad="En uzun seri" deger={sayi(oyun.enUzunSeri)} />
              ) : null}
              {oyun.galibiyetOrani === null ? null : (
                <Satir
                  ad="Galibiyet"
                  deger={`%${oyun.galibiyetOrani} (${oyun.galibiyet}/${oyun.mac})`}
                />
              )}
              <Satir ad="İlk görülme" deger={tarih(oyun.ilkGorulme)} />
              <Satir ad="Son görülme" deger={tarih(oyun.sonGorulme)} />
            </dl>

            {/* BM'nin gördüğü süre AYRI tabloda: bizimkiyle toplanmıyor,
                ikisi aynı saatleri iki kez sayar. */}
            {bm.sunucular.length > 0 ? (
              <div className="mt-4 border-t border-border pt-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-xs text-fg-muted">BattleMetrics'te görünen</h3>
                  <span className="text-2xs text-fg-faint">
                    {bm.syncedAt ? `${gecenSure(bm.syncedAt)} okundu` : 'okunmadı'}
                  </span>
                </div>
                <ul className="mt-2 flex flex-col">
                  {bm.sunucular.map((s) => (
                    <li
                      key={s.bmServerId}
                      className="flex items-baseline justify-between gap-3 border-b border-border py-1.5 last:border-0"
                    >
                      <span className="min-w-0 truncate text-footnote text-fg-muted">
                        {s.serverName ?? s.bmServerId}
                      </span>
                      <span className="num shrink-0 text-xs text-fg-muted">
                        {s.timePlayed ? sure(s.timePlayed) : '–'}
                      </span>
                    </li>
                  ))}
                </ul>
                {bmSaniye > 0 ? (
                  <p className="mt-2 text-2xs text-fg-faint">
                    BM toplamı <span className="num">{sure(bmSaniye)}</span>. Bizim kaydımızla
                    toplanmıyor: ikisi aynı saatleri iki kez sayar.
                  </p>
                ) : null}
              </div>
            ) : null}

            {bm.acik && yetkiler.notYazabilir ? (
              <div className="mt-3 text-2xs text-fg-faint">
                <BmTazele apiUrl={apiUrl} playerId={player.id} />
              </div>
            ) : null}
          </Bolum>

          {/* --- Birlikte oynadıkları: BM'de "Related Players" --- */}
          <Bolum baslik="Birlikte oynadıkları">
            <CoplayPanel apiUrl={apiUrl} playerId={player.id} />
          </Bolum>
        </div>

        {/* ====== SAĞ: BM'deki Activity Log ====== */}
        <aside className="min-w-0">
          {/* Ekranla birlikte duruyor ve kendi içinde kayıyor: BM'de de
              sayfa boyunca sağda sabit. `sticky` yalnızca geniş ekranda;
              dar ekranda sütun altına iniyor. */}
          <section className="flex max-h-[calc(100dvh-7rem)] flex-col rounded border border-border bg-surface xl:sticky xl:top-4">
            <header className="flex shrink-0 items-baseline justify-between gap-2 px-4 pt-3.5 pb-2">
              <h2 className="text-sm font-semibold">Sohbet</h2>
              <span className="num text-xs text-fg-faint">{profil.sohbet.length}</span>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
              <ChatPanel apiUrl={apiUrl} playerId={player.id} ilkMesajlar={profil.sohbet} />
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

const KAYIT_ETIKET = { note: 'Not', warning: 'Uyarı', watchlist: 'Takip' } as const;

/**
 * Katlanabilir bölüm — BM'deki ▾ başlıklar.
 *
 * `<details>` ile: JavaScript gerekmiyor, klavyeyle açılıyor, ekran
 * okuyucu durumu söylüyor. Hangisinin açık geleceği karara göre: ban ve
 * kayıtlar açık, kimlikler ve süre kapalı.
 */
function Bolum({
  baslik,
  sayac,
  acik,
  children,
}: {
  baslik: string;
  sayac?: number;
  acik?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={acik} className="group rounded border border-border bg-surface">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold marker:content-none">
        {/* Ok, açıkken aşağı dönüyor. Yazı tipi karakteri değil svg:
            karakterler yüze göre farklı hizalanıyor. */}
        <svg
          viewBox="0 0 12 12"
          width="11"
          height="11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="shrink-0 text-fg-faint transition-transform group-open:rotate-90"
        >
          <path d="M4.5 2.5 8 6l-3.5 3.5" />
        </svg>
        <span className="min-w-0 flex-1">{baslik}</span>
        {sayac === undefined ? null : (
          <span className="num shrink-0 text-xs font-normal text-fg-faint">{sayac}</span>
        )}
      </summary>
      <div className="border-t border-border px-4 pt-3 pb-4">{children}</div>
    </details>
  );
}

function Satir({ ad, deger }: { ad: string; deger: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-2xs text-fg-faint">{ad}</dt>
      <dd className="num truncate text-footnote">{deger}</dd>
    </div>
  );
}

function Sayac({ etiket, deger, vurgu }: { etiket: string; deger: number; vurgu?: boolean }) {
  return (
    <div className="text-right">
      <div className={cn('display text-lg leading-tight', vurgu ? 'text-danger' : '')}>
        {sayi(deger)}
      </div>
      <div className="text-2xs text-fg-faint">{etiket}</div>
    </div>
  );
}

function Bos({ metin }: { metin: string }) {
  return <p className="py-6 text-center text-xs text-fg-muted">{metin}</p>;
}
