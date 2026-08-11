'use client';

import { BekleyenTakim } from '@/components/bekleyen-takim';
import { PlayerMenu } from '@/components/player-menu';
import { type Istek, TakimDegistirKutusu } from '@/components/takim-degistir';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Ana ekran: o an sunucuda kim var, ne oluyor.
 *
 * Düzen BattleMetrics'in kontrol panelinden alındı çünkü moderasyon o
 * düzene alışkın: solda oyuncu tablosu (kimlik, takım, manga, rol), sağda
 * tek zaman çizgisinde olay akışı (giriş, çıkış, manga, sohbet).
 *
 * Tek WebSocket besliyor; hem sunucu durumu hem olaylar aynı bağlantıdan
 * geliyor, yoklama yok.
 */

interface LivePlayer {
  steamId: string;
  eosId: string | null;
  name: string;
  joinedAt: string;
  teamId: number | null;
  squadId: number | null;
  squadName: string | null;
  role: string | null;
  isLeader: boolean;
}

interface LiveServerState {
  serverSlug: string;
  playerCount: number;
  queueCount: number;
  layer?: string;
  /** Sunucu tick hızı. Tanımsız = bilinmiyor, 0 ile aynı şey değil. */
  tickRate?: number;
  players: LivePlayer[];
  updatedAt: string;
}

/**
 * TPS'in rengi.
 *
 * Squad sunucusu 50 tick hedefliyor ve sağlıklıyken oralarda geziyor
 * (canlıda ölçüldü: 49,7). Oyuncular düşüşü 40'ın altında fark etmeye
 * başlıyor, 30'un altı "sunucu kasıyor" şikâyetinin geldiği bölge.
 * Sayıyı okumak yerine renge bakmak yeterli olsun diye.
 */
function tpsRengi(tps: number): string {
  if (tps >= 40) return 'text-success';
  if (tps >= 30) return 'text-warn';
  return 'text-danger';
}

/**
 * Sürüklenen şeyin taşıdığı veri.
 *
 * dataTransfer'a JSON olarak konuyor: React state'i kullanmak cazipti ama
 * sürükleme tarayıcının kendi olayları üzerinden yürüyor ve bırakma anında
 * state güncel olmayabiliyor. Yük olayla birlikte taşınınca bu risk yok.
 */
const SURUKLE_TURU = 'application/x-altai-takim';

/** Ctrl ile seçilmiş bir oyuncu. */
export interface SeciliKayit {
  steamId: string;
  name: string;
  takim: 1 | 2;
}

interface SurukleYuku {
  /** Her adayın o anki takımı da taşınıyor: hedef panel neyi taşıyacağını
   *  ve neyin zaten yerinde olduğunu bırakma anında bilmeli. */
  adaylar: { steamId: string; name: string; takim: 1 | 2 }[];
  baslik?: string;
}

type AdminIslem = 'warn' | 'kick' | 'ban' | 'broadcast' | 'cam_enter' | 'cam_exit';

interface CanliOlay {
  id: string;
  tur: 'join' | 'leave' | 'squad' | 'chat' | 'admin';
  serverSlug: string;
  name: string | null;
  steamId: string | null;
  channel?: string;
  message?: string;
  squadId?: string;
  squadName?: string;
  /** Yalnızca yetkili işlemi. */
  adminIslem?: AdminIslem;
  sure?: string;
  timestamp: string;
}

/**
 * Yetkili işlemlerinin okunur karşılığı.
 *
 * Oyundan gelen ham metin İngilizce ("Remote admin has warned player X");
 * akışta Türkçe ve kısa duruyor, çünkü satır sohbetin arasında ve göz
 * ucuyla taranıyor.
 */
const ADMIN_ETIKET: Record<AdminIslem, string> = {
  warn: 'uyarıldı',
  kick: 'sunucudan atıldı',
  ban: 'banlandı',
  broadcast: 'duyuru',
  cam_enter: 'admin kamerasına girdi',
  cam_exit: 'admin kamerasından çıktı',
};

const KANAL_RENK: Record<string, string> = {
  All: 'text-fg-faint',
  Team: 'text-team2',
  Squad: 'text-success',
  Admin: 'text-accent',
};
const KANAL_ETIKET: Record<string, string> = {
  All: 'GENEL',
  Team: 'TAKIM',
  Squad: 'MANGA',
  Admin: 'ADMIN',
};

const OLAY_TAVANI = 600;

function saat(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '--:--'
    : d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

/** "2 sa 14 dk" — oyuncunun ne kadardır sunucuda olduğu. */
function suredir(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const dk = Math.floor(ms / 60000);
  if (dk < 60) return `${dk} dk`;
  return `${Math.floor(dk / 60)} sa ${dk % 60} dk`;
}

/** WPMC_Rifleman_01 -> Rifleman. Ham rol adı tabloyu okunmaz yapıyor. */
function rolKisalt(role: string | null): string {
  if (!role) return '—';
  const parcalar = role.split('_');
  return parcalar.length > 1 ? (parcalar[1] ?? role) : role;
}

export function LiveDashboard({
  wsUrl,
  apiUrl,
  kickYetkisi,
  warnYetkisi,
  takimYetkisi,
}: {
  wsUrl: string;
  apiUrl: string;
  kickYetkisi: boolean;
  warnYetkisi: boolean;
  takimYetkisi: boolean;
}) {
  const [sunucular, setSunucular] = useState<Record<string, LiveServerState>>({});
  const [olaylar, setOlaylar] = useState<CanliOlay[]>([]);
  const [bagli, setBagli] = useState(false);
  const [oyuncuArama, setOyuncuArama] = useState('');
  const [olaySuzgeci, setOlaySuzgeci] = useState<CanliOlay['tur'] | null>(null);
  // Onay bekleyen takım değişimi. null = kutu kapalı.
  const [takimIstegi, setTakimIstegi] = useState<Istek | null>(null);
  /**
   * Ctrl ile işaretlenen oyuncular.
   *
   * Map çünkü sürüklerken isim de lazım ve seçili oyuncu o sırada
   * listeden düşmüş olabilir (çıkmış, takım değiştirmiş). Seçim anındaki
   * adı taşımak, sonradan aramaktan güvenli.
   */
  const [secili, setSecili] = useState<Map<string, SeciliKayit>>(new Map());

  const akisKutusu = useRef<HTMLDivElement | null>(null);
  const altta = useRef(true);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let kapandi = false;
    let yenidenDene: ReturnType<typeof setTimeout> | undefined;

    function bagla() {
      ws = new WebSocket(wsUrl);
      ws.onopen = () => setBagli(true);
      ws.onclose = () => {
        setBagli(false);
        // Kopukluk fark edilmezse eski veriye bakılır; sessizce ölmesin.
        if (!kapandi) yenidenDene = setTimeout(bagla, 3000);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data as string) as
          | { type: 'snapshot'; servers: LiveServerState[] }
          | { type: 'update'; serverSlug: string; state: LiveServerState }
          | { type: 'feed_snapshot'; events: CanliOlay[] }
          | { type: 'feed'; event: CanliOlay };

        if (msg.type === 'snapshot') {
          const m: Record<string, LiveServerState> = {};
          for (const s of msg.servers) m[s.serverSlug] = s;
          setSunucular(m);
        } else if (msg.type === 'update') {
          setSunucular((o) => ({ ...o, [msg.serverSlug]: msg.state }));
        } else if (msg.type === 'feed_snapshot') {
          setOlaylar(msg.events);
        } else if (msg.type === 'feed') {
          setOlaylar((o) => {
            const y = [...o, msg.event];
            return y.length > OLAY_TAVANI ? y.slice(-OLAY_TAVANI) : y;
          });
        }
      };
    }

    bagla();
    return () => {
      kapandi = true;
      if (yenidenDene) clearTimeout(yenidenDene);
      ws?.close();
    };
  }, [wsUrl]);

  // Otomatik kaydırma YALNIZCA en alttayken: biri yukarı kaydırıp eski bir
  // satırı okurken listeyi zorla aşağı çekmek en sinir bozucu davranış.
  useEffect(() => {
    if (!altta.current) return;
    const el = akisKutusu.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const sunucuListesi = useMemo(
    () => Object.values(sunucular).sort((a, b) => a.serverSlug.localeCompare(b.serverSlug)),
    [sunucular],
  );

  const tumOyuncular = useMemo(
    () => sunucuListesi.flatMap((s) => s.players.map((p) => ({ ...p, serverSlug: s.serverSlug }))),
    [sunucuListesi],
  );

  const aranan = oyuncuArama.trim().toLocaleLowerCase('tr');
  const gosterilenOyuncular = useMemo(() => {
    const liste = aranan
      ? tumOyuncular.filter(
          (p) =>
            p.name.toLocaleLowerCase('tr').includes(aranan) ||
            p.steamId.includes(aranan) ||
            (p.eosId ?? '').includes(aranan) ||
            (p.squadName ?? '').toLocaleLowerCase('tr').includes(aranan),
        )
      : tumOyuncular;
    // Takım, sonra manga, sonra isim: BattleMetrics'teki gibi mangalar bir
    // arada dursun, mangasızlar sona düşsün.
    return [...liste].sort(
      (a, b) =>
        (a.teamId ?? 9) - (b.teamId ?? 9) ||
        (a.squadId ?? 999) - (b.squadId ?? 999) ||
        a.name.localeCompare(b.name, 'tr'),
    );
  }, [tumOyuncular, aranan]);

  const olaySayilari = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of olaylar) m.set(o.tur, (m.get(o.tur) ?? 0) + 1);
    return m;
  }, [olaylar]);

  const gosterilenOlaylar = olaySuzgeci ? olaylar.filter((o) => o.tur === olaySuzgeci) : olaylar;

  const toplamOyuncu = sunucuListesi.reduce((a, s) => a + s.playerCount, 0);
  const toplamKuyruk = sunucuListesi.reduce((a, s) => a + s.queueCount, 0);

  /**
   * Ctrl+tıklama ile seçimi değiştirir.
   *
   * Seçim İKİ TAKIMDAN da olabiliyor: işlem "karşıya çevir" değil "şu
   * takımda topla" olduğu için karışık seçimin anlamı net — hepsi
   * bırakıldığı panelin takımına gider, zaten orada olanlara dokunulmaz.
   */
  const seciliDegistir = useCallback((steamId: string, name: string, takim: 1 | 2) => {
    setSecili((eski) => {
      const yeni = new Map(eski);
      if (yeni.has(steamId)) yeni.delete(steamId);
      else yeni.set(steamId, { steamId, name, takim });
      return yeni;
    });
  }, []);

  const secimiTemizle = useCallback(() => setSecili(new Map()), []);

  // Escape seçimi bırakır: yanlış seçim yapan kişinin ilk refleksi.
  useEffect(() => {
    if (secili.size === 0) return;
    const tus = (e: KeyboardEvent) => {
      if (e.key === 'Escape') secimiTemizle();
    };
    document.addEventListener('keydown', tus);
    return () => document.removeEventListener('keydown', tus);
  }, [secili.size, secimiTemizle]);

  // Sürükleme ve menü aynı kutuyu açıyor; hangi sunucudan geldiği
  // adaylardan değil canlı listeden çözülüyor (tek sunucu varsayımı yok).
  const istekSlug =
    takimIstegi &&
    tumOyuncular.find((p) => p.steamId === takimIstegi.adaylar[0]?.steamId)?.serverSlug;

  return (
    <main className="mx-auto flex h-full w-full max-w-[110rem] flex-col gap-3 px-5 py-4">
      {takimIstegi && istekSlug ? (
        <TakimDegistirKutusu
          apiUrl={apiUrl}
          slug={istekSlug}
          istek={takimIstegi}
          kapat={() => {
            setTakimIstegi(null);
            // Seçim iş bitince duruyorsa bir sonraki sürüklemede sessizce
            // fazladan oyuncu taşınırdı.
            secimiTemizle();
          }}
        />
      ) : null}
      <header className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-xs font-semibold',
            bagli ? 'text-success' : 'text-danger',
          )}
        >
          <span
            className={cn('h-2 w-2 rounded-full', bagli ? 'bg-success' : 'bg-danger')}
            aria-hidden
          />
          {bagli ? 'canlı' : 'bağlantı yok'}
        </span>
        <span className="display text-lg">
          {toplamOyuncu}
          {toplamKuyruk > 0 ? (
            <span className="ml-1 text-xs font-semibold text-fg-muted">+{toplamKuyruk} kuyruk</span>
          ) : null}
        </span>
        {sunucuListesi.map((s) => (
          <span key={s.serverSlug} className="text-xs text-fg-muted last:mr-auto">
            <span className="font-semibold text-fg">{s.serverSlug}</span>
            {s.layer ? ` · ${s.layer}` : ''} · {s.playerCount}
            {s.tickRate !== undefined ? (
              <>
                {' · '}
                <span className={cn('num font-semibold', tpsRengi(s.tickRate))}>
                  {s.tickRate.toFixed(1)}
                </span>
                <span className="ml-0.5">TPS</span>
              </>
            ) : null}
          </span>
        ))}
        {secili.size > 0 ? (
          <button
            type="button"
            onClick={secimiTemizle}
            className="rounded-full border border-accent-line bg-accent-weak px-2.5 py-1 text-[11px] font-semibold text-accent hover:bg-surface-2"
            title="Seçimi bırak (Esc)"
          >
            {secili.size} seçili ×
          </button>
        ) : null}
        <BekleyenTakim
          apiUrl={apiUrl}
          slug={sunucuListesi[0]?.serverSlug ?? null}
          yetki={takimYetkisi}
        />
        {/* Bölüm bağlantıları üst çubukta; burada tekrarlamıyoruz. */}
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_1.1fr]">
        {/* --------------------------------------------- takım tahtaları */}
        <TakimPaneli
          takim={1}
          oyuncular={gosterilenOyuncular}
          toplam={tumOyuncular.length}
          arama={oyuncuArama}
          setArama={setOyuncuArama}
          apiUrl={apiUrl}
          kickYetkisi={kickYetkisi}
          warnYetkisi={warnYetkisi}
          takimYetkisi={takimYetkisi}
          takimaSurukle={setTakimIstegi}
          secili={secili}
          seciliDegistir={seciliDegistir}
        />
        <TakimPaneli
          takim={2}
          oyuncular={gosterilenOyuncular}
          toplam={tumOyuncular.length}
          apiUrl={apiUrl}
          kickYetkisi={kickYetkisi}
          warnYetkisi={warnYetkisi}
          takimYetkisi={takimYetkisi}
          takimaSurukle={setTakimIstegi}
          secili={secili}
          seciliDegistir={seciliDegistir}
        />

        {/* ------------------------------------------------------ olay akışı */}
        <section className="flex min-h-0 flex-col rounded border border-border bg-surface">
          <div className="shrink-0 px-4 pt-3.5 pb-2">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-sm font-semibold">Akış</h2>
              <span className="num text-xs text-fg-faint">{olaylar.length}</span>
            </div>
            <div className="flex flex-wrap gap-1">
              <Cip etkin={olaySuzgeci === null} onClick={() => setOlaySuzgeci(null)}>
                hepsi {olaylar.length}
              </Cip>
              {(['chat', 'admin', 'join', 'leave', 'squad'] as const)
                .filter((t) => olaySayilari.has(t))
                .map((t) => (
                  <Cip
                    key={t}
                    etkin={olaySuzgeci === t}
                    onClick={() => setOlaySuzgeci(olaySuzgeci === t ? null : t)}
                  >
                    {
                      {
                        chat: 'sohbet',
                        admin: 'yetkili',
                        join: 'giriş',
                        leave: 'çıkış',
                        squad: 'manga',
                      }[t]
                    }{' '}
                    {olaySayilari.get(t)}
                  </Cip>
                ))}
            </div>
          </div>

          <div
            ref={akisKutusu}
            onScroll={(e) => {
              const el = e.currentTarget;
              altta.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            className="min-h-0 flex-1 overflow-y-auto px-4 pb-4"
          >
            {gosterilenOlaylar.length === 0 ? (
              <p className="py-8 text-center text-xs text-fg-muted">Henüz olay yok</p>
            ) : (
              // Son satırın altındaki çizgi kaldırılıyor: kaydırma alanının
              // dibinde asılı kalan bir çizgi bitmemiş görünüyor.
              <ul className="flex flex-col [&>li:last-child>span:last-child]:border-b-0">
                {gosterilenOlaylar.map((o) => (
                  <li
                    key={o.id}
                    // Izgara ŞART: satır tek parça metin olduğunda uzun mesaj
                    // sarınca zamanın altına kayıyor ve göz hizayı kaybediyor.
                    // Sabit zaman sütunu + içerik sütunu asılı girinti veriyor.
                    className={cn(
                      'grid grid-cols-[2.6rem_1fr] gap-x-2 px-1.5',
                      'hover:bg-surface-2',
                      // Sistem olayları sohbetle yarışmamalı: sohbet okunmak
                      // için, giriş/çıkış göz ucuyla taranmak için.
                      o.tur === 'chat' || o.tur === 'admin' ? 'text-[13px]' : 'text-[12px]',
                    )}
                  >
                    <span className="num pt-[7px] text-right text-[11px] text-fg-faint">
                      {saat(o.timestamp)}
                    </span>
                    {/* Çizgi zaman sütunundan SONRA başlıyor (iOS tablo
                        kalıbı): tam genişlikte olsaydı dar panelde her 20
                        pikselde bir çizgi çıkıp okumayı bölerdi. */}
                    <span className="min-w-0 border-b border-border py-[6px] leading-[1.45]">
                      <OlaySatiri olay={o} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

/**
 * Tek olay satırı.
 *
 * Sohbette İSİM renkli ve dolgun, MESAJ normal: sohbet istemcilerinin
 * evrensel kalıbı ve okurken gözün kime ait olduğunu aramasını engelliyor.
 * Önceki sürümde mesaj sönük griydi — asıl okunacak şey en zayıf renkteydi.
 *
 * Kanal, metin etiketi yerine renkli NOKTA ile gösteriliyor: uzun bir
 * listede her satırın başındaki büyük harfli "GENEL/TAKIM/MANGA" bloğu
 * gürültü yapıyordu; renk zaten ayırt ediyor, sözcük yer kaplıyor.
 * Nokta `title` taşıyor, üstüne gelince kanal adı çıkıyor.
 */
/**
 * Takım tahtası: oyuncular MANGAYA göre gruplu.
 *
 * Düz liste, sunucudaki gerçek yapıyı gizliyordu — Squad'da anlamlı birim
 * manga ve moderasyon "hangi mangada kim var" diye bakıyor. Oyun içindeki
 * skor tahtasıyla aynı kırılım.
 *
 * Mangasızlar en sona: sayıları çok ve genelde yeni girenler, mangaların
 * arasına karışınca yapı okunmuyor.
 */
function TakimPaneli({
  takim,
  oyuncular,
  toplam,
  arama,
  setArama,
  apiUrl,
  kickYetkisi,
  warnYetkisi,
  takimYetkisi,
  takimaSurukle,
  secili,
  seciliDegistir,
}: {
  takim: 1 | 2;
  oyuncular: (LivePlayer & { serverSlug: string })[];
  toplam: number;
  arama?: string;
  setArama?: (v: string) => void;
  apiUrl: string;
  kickYetkisi: boolean;
  warnYetkisi: boolean;
  takimYetkisi: boolean;
  takimaSurukle: (istek: Istek) => void;
  secili: Map<string, SeciliKayit>;
  seciliDegistir: (steamId: string, name: string, takim: 1 | 2) => void;
}) {
  const benimkiler = oyuncular.filter((p) => p.teamId === takim);
  // Üzerine sürüklenirken panelin kenarı yanıyor: bırakmanın nereye
  // gideceği belirsiz kalmamalı.
  const [uzerinde, setUzerinde] = useState(false);

  const mangalar = new Map<number, (LivePlayer & { serverSlug: string })[]>();
  const mangasiz: (LivePlayer & { serverSlug: string })[] = [];
  for (const p of benimkiler) {
    if (p.squadId) {
      const liste = mangalar.get(p.squadId);
      if (liste) liste.push(p);
      else mangalar.set(p.squadId, [p]);
    } else {
      mangasiz.push(p);
    }
  }
  const sirali = [...mangalar.entries()].sort((a, b) => a[0] - b[0]);
  const renk = takim === 1 ? 'text-team1' : 'text-team2';

  /**
   * Bırakılan panelin takımı HEDEF oluyor.
   *
   * Aynı panele bırakmak da geçerli olabilir: karışık bir seçimde bazıları
   * zaten burada, bazıları karşıda. Yapacak iş yoksa (herkes zaten bu
   * takımda) bırakma yok sayılıyor — boş bir onay kutusu açmak kullanıcıyı
   * "bir şey oldu" sanmaya iter.
   */
  function yukuOku(e: React.DragEvent): SurukleYuku | null {
    try {
      const ham = e.dataTransfer.getData(SURUKLE_TURU);
      if (!ham) return null;
      const yuk = JSON.parse(ham) as SurukleYuku;
      return yuk.adaylar.some((a) => a.takim !== takim) ? yuk : null;
    } catch {
      return null;
    }
  }

  return (
    <section
      onDragOver={(e) => {
        if (!takimYetkisi) return;
        // preventDefault ŞART: olmadan tarayıcı bırakmaya hiç izin vermiyor.
        e.preventDefault();
        setUzerinde(true);
      }}
      onDragLeave={() => setUzerinde(false)}
      onDrop={(e) => {
        setUzerinde(false);
        if (!takimYetkisi) return;
        e.preventDefault();
        const yuk = yukuOku(e);
        if (yuk) takimaSurukle({ ...yuk, hedefTakim: takim });
      }}
      className={cn(
        'flex min-h-0 flex-col rounded border bg-surface transition-colors',
        uzerinde ? 'border-accent' : 'border-border',
      )}
    >
      <div className="shrink-0 px-4 pt-3.5 pb-2">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className={cn('text-sm font-semibold', renk)}>Takım {takim}</h2>
          <span className="num text-xs text-fg-faint">
            {benimkiler.length} · {sirali.length} manga
          </span>
        </div>
        {setArama ? (
          <Input
            value={arama ?? ''}
            onChange={(e) => setArama(e.target.value)}
            placeholder="İsim, SteamID, EOS ya da manga…"
            className="min-h-9 px-3.5 text-[13px]"
          />
        ) : (
          // İkinci panelde kutu yok ama hizanın bozulmaması için aynı
          // yüksekliği ayırıyoruz.
          <div className="min-h-9" aria-hidden />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {benimkiler.length === 0 ? (
          <p className="py-8 text-center text-xs text-fg-muted">
            {toplam === 0 ? 'Sunucuda kimse yok' : 'Bu takımda eşleşen yok'}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {sirali.map(([no, uyeler]) => (
              <Manga
                key={no}
                baslik={`${no}. ${uyeler[0]?.squadName ?? 'Manga'}`}
                uyeler={uyeler}
                apiUrl={apiUrl}
                kickYetkisi={kickYetkisi}
                warnYetkisi={warnYetkisi}
                takimYetkisi={takimYetkisi}
                takim={takim}
                takimaSurukle={takimaSurukle}
                secili={secili}
                seciliDegistir={seciliDegistir}
              />
            ))}
            {mangasiz.length > 0 ? (
              <Manga
                baslik="Mangasız"
                uyeler={mangasiz}
                sonuk
                apiUrl={apiUrl}
                kickYetkisi={kickYetkisi}
                warnYetkisi={warnYetkisi}
                takimYetkisi={takimYetkisi}
                takim={takim}
                takimaSurukle={takimaSurukle}
                secili={secili}
                seciliDegistir={seciliDegistir}
              />
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function Manga({
  baslik,
  uyeler,
  sonuk,
  apiUrl,
  kickYetkisi,
  warnYetkisi,
  takimYetkisi,
  takim,
  takimaSurukle,
  secili,
  seciliDegistir,
}: {
  baslik: string;
  uyeler: (LivePlayer & { serverSlug: string })[];
  sonuk?: boolean;
  apiUrl: string;
  kickYetkisi: boolean;
  warnYetkisi: boolean;
  takimYetkisi: boolean;
  takim: 1 | 2;
  takimaSurukle: (istek: Istek) => void;
  secili: Map<string, SeciliKayit>;
  seciliDegistir: (steamId: string, name: string, takim: 1 | 2) => void;
}) {
  // Manga lideri başta: skor tahtasında da öyle ve "kime yazayım" sorusunun
  // cevabı o.
  const sirali = [...uyeler].sort(
    (a, b) => Number(b.isLeader) - Number(a.isLeader) || a.name.localeCompare(b.name, 'tr'),
  );
  /** Sürüklenen yükü olaya yazar; oyuncu ve manga aynı biçimi kullanıyor. */
  function yukuYaz(e: React.DragEvent, yuk: SurukleYuku) {
    e.dataTransfer.setData(SURUKLE_TURU, JSON.stringify(yuk));
    e.dataTransfer.effectAllowed = 'move';
  }

  return (
    <div>
      {/* Sürükleme tutamağı manga BAŞLIĞI: satırın kendisi sürüklenebilir
          olsaydı tek oyuncu taşımak isteyen kişi kazara mangayı taşırdı.

          "Mangasız" SÜRÜKLENEMEZ (`sonuk`): o bir manga değil, mangaya
          girmemiş herkesin toplandığı kutu — dolu sunucuda 20'yi geçiyor.
          Tek kazara hareketle yarım takımı karşıya atmak maçı bitirirdi.
          Oradan tek tek oyuncu sürüklemek çalışmaya devam ediyor. */}
      <div
        draggable={takimYetkisi && !sonuk}
        onDragStart={(e) =>
          yukuYaz(e, {
            adaylar: uyeler.map((u) => ({ steamId: u.steamId, name: u.name, takim })),
            baslik,
          })
        }
        className={cn(
          'mb-1 flex items-baseline justify-between gap-2 border-b border-border pb-1',
          takimYetkisi && !sonuk && 'cursor-grab active:cursor-grabbing',
        )}
        title={takimYetkisi && !sonuk ? 'Karşı takıma sürükle' : undefined}
      >
        <span
          className={cn(
            'truncate text-[11px] font-semibold uppercase tracking-wide',
            sonuk ? 'text-fg-faint' : 'text-fg-muted',
          )}
        >
          {baslik}
        </span>
        <span className="num shrink-0 text-[11px] text-fg-faint">{uyeler.length}</span>
      </div>
      <ul className="flex flex-col">
        {sirali.map((p) => (
          <li
            key={`${p.serverSlug}:${p.steamId}`}
            draggable={takimYetkisi}
            onDragStart={(e) => {
              // Yayılmayı durduruyoruz: satır manga kutusunun içinde ve
              // olay yukarı çıkarsa manganın tamamı sürüklenmiş sayılırdı.
              e.stopPropagation();
              // Sürüklenen oyuncu seçiliyse SEÇİMİN TAMAMI taşınıyor.
              // Seçili olmayan biri sürüklendiğinde seçim yok sayılıyor:
              // "şunu da alayım" diye sürükleyen kişi, farkında olmadığı
              // eski bir seçimi de taşımış olmamalı.
              const secim = [...secili.values()];
              const cokluMu = secili.has(p.steamId) && secim.length > 1;
              yukuYaz(e, {
                adaylar: cokluMu
                  ? secim.map((x) => ({ steamId: x.steamId, name: x.name, takim: x.takim }))
                  : [{ steamId: p.steamId, name: p.name, takim }],
                ...(cokluMu ? { baslik: `${secim.length} seçili oyuncu` } : {}),
              });
            }}
            className={cn(
              'group flex items-baseline gap-1 rounded-sm px-1',
              // Seçili işareti HALKA ile: kenarlık 1 piksel yer kaplar ve
              // yoğun listede satırlar seçildikçe oynardı. `ring-inset`
              // çizgiyi kutunun içine koyuyor, hiçbir şey kaymıyor.
              // Zemin + halka + tam kontrastlı isim birlikte: tek başına
              // zemin (rgba .14) bu kadar dar bir satırda fark edilmiyordu.
              secili.has(p.steamId)
                ? 'bg-accent-weak text-fg ring-1 ring-inset ring-accent'
                : 'hover:bg-surface-2',
              takimYetkisi && 'cursor-grab active:cursor-grabbing',
            )}
            title={
              takimYetkisi
                ? 'Sürükleyerek karşı takıma at · Ctrl+tık ile birden fazla seç'
                : undefined
            }
          >
            <Link
              href={`/oyuncular?q=${p.steamId}`}
              onClick={(e) => {
                // Ctrl/Cmd + tıklama seçim yapar, profile gitmez.
                // Tarayıcının "yeni sekmede aç" davranışı da bu yüzden
                // engelleniyor — burada tuşun anlamı seçmek.
                if (!takimYetkisi || !(e.ctrlKey || e.metaKey)) return;
                e.preventDefault();
                seciliDegistir(p.steamId, p.name, takim);
              }}
              className="flex min-w-0 flex-1 items-baseline justify-between gap-2 py-[3px] text-[13px]"
            >
              <span className="min-w-0 truncate">
                {p.isLeader ? (
                  <span className="mr-1.5 text-[10px] font-semibold text-accent">SL</span>
                ) : null}
                {p.name}
              </span>
              {/* Rol ve ne kadardır içeride: ikisi de moderasyonda bakılan
                  şeyler, yan yana sığıyor. */}
              <span className="num shrink-0 text-[11px] text-fg-faint">
                {rolKisalt(p.role)}
                <span className="ml-1.5 opacity-70">{suredir(p.joinedAt)}</span>
              </span>
            </Link>
            <PlayerMenu
              apiUrl={apiUrl}
              slug={p.serverSlug}
              steamId={p.steamId}
              isim={p.name}
              kickYetkisi={kickYetkisi}
              warnYetkisi={warnYetkisi}
              takimYetkisi={takimYetkisi}
              takimaAt={(hedefTakim) => {
                // Sürüklemeyle aynı kural: bu oyuncu seçiliyse seçimin
                // tamamı taşınıyor. İki giriş noktasının farklı davranması
                // en kötüsü olurdu.
                const secim = [...secili.values()];
                const cokluMu = secili.has(p.steamId) && secim.length > 1;
                takimaSurukle({
                  adaylar: cokluMu
                    ? secim.map((x) => ({ steamId: x.steamId, name: x.name, takim: x.takim }))
                    : [{ steamId: p.steamId, name: p.name, takim }],
                  hedefTakim,
                  ...(cokluMu ? { baslik: `${secim.length} seçili oyuncu` } : {}),
                });
              }}
              oyuncuTakimi={takim}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function OlaySatiri({ olay }: { olay: CanliOlay }) {
  const isimMetni = olay.name ?? olay.steamId ?? '(bilinmiyor)';

  if (olay.tur === 'chat') {
    const renk = KANAL_RENK[olay.channel ?? ''] ?? 'text-fg-muted';
    return (
      <>
        <span
          className={cn('mr-1.5 align-[0.09em] text-[9px]', renk)}
          title={KANAL_ETIKET[olay.channel ?? ''] ?? olay.channel}
          aria-hidden
        >
          ●
        </span>
        {olay.steamId ? (
          <Link
            href={`/oyuncular?q=${olay.steamId}`}
            className={cn('font-semibold hover:underline', renk)}
          >
            {isimMetni}
          </Link>
        ) : (
          <span className={cn('font-semibold', renk)}>{isimMetni}</span>
        )}
        <span className="ml-1.5 break-words">{olay.message}</span>
      </>
    );
  }

  if (olay.tur === 'admin') {
    const islem = olay.adminIslem ?? 'warn';
    // Yetkili işlemi sönük OLMAMALI: giriş/çıkış göz ucuyla taranıyor ama
    // "şu oyuncu banlandı" satırı akışta kaybolmamalı.
    const renk = islem === 'ban' || islem === 'kick' ? 'text-danger' : 'text-warn';
    return (
      <span className="text-fg-muted">
        <span className={cn('mr-1.5 align-[0.09em] text-[9px]', renk)} aria-hidden>
          ◆
        </span>
        {olay.name ? (
          olay.steamId ? (
            <Link href={`/oyuncular?q=${olay.steamId}`} className="font-medium hover:underline">
              {olay.name}
            </Link>
          ) : (
            // Squad uyarı satırında kimlik vermiyor; isimden profil
            // aramasına gitmek yine de işe yarıyor.
            <Link
              href={`/oyuncular?q=${encodeURIComponent(olay.name)}`}
              className="font-medium hover:underline"
            >
              {olay.name}
            </Link>
          )
        ) : null}
        <span className={cn('ml-1.5 font-medium', renk)}>{ADMIN_ETIKET[islem]}</span>
        {olay.sure ? <span className="ml-1 text-fg-faint">({olay.sure})</span> : null}
        {olay.message ? <span className="ml-1.5 break-words">· {olay.message}</span> : null}
      </span>
    );
  }

  // Sistem olayları: tek renk, ismi vurgulu ama satırın tamamı sönük.
  const isim = olay.steamId ? (
    <Link href={`/oyuncular?q=${olay.steamId}`} className="font-medium hover:text-fg">
      {isimMetni}
    </Link>
  ) : (
    <span className="font-medium">{isimMetni}</span>
  );

  const aciklama =
    olay.tur === 'join'
      ? 'girdi'
      : olay.tur === 'leave'
        ? 'çıktı'
        : `manga ${olay.squadId} kurdu${olay.squadName ? ` · ${olay.squadName}` : ''}`;

  return (
    <span className="text-fg-faint">
      {isim} {aciklama}
    </span>
  );
}

function Cip({
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
        'rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors',
        etkin ? 'bg-accent-weak text-accent-2' : 'text-fg-muted hover:bg-surface-2',
      )}
    >
      {children}
    </button>
  );
}
