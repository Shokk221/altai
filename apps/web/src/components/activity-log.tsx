'use client';

import { cn } from '@/lib/cn';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Sistem günlüğü ekranı.
 *
 * Günlüğün işe yaraması okunabilmesine bağlı: satır sayısı çok, ilgi
 * çeken olay az. Bu yüzden her satır TEK satır — zaman, kim, ne, kime —
 * ve ayrıntı ancak tıklanınca açılıyor. Kategoriler sekme: "ban kim
 * attı" ile "kim giriş yaptı" farklı sorular ve aynı listede aranmıyor.
 */

export interface Kayit {
  id: string;
  at: string;
  actorType: string;
  actorUserId: string | null;
  actorLabel: string | null;
  action: string;
  category: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  method: string | null;
  path: string | null;
  route: string | null;
  statusCode: number | null;
  durationMs: number | null;
  ip: string | null;
  payload: Record<string, unknown> | null;
  requestId: string | null;
}

export interface Imlec {
  before: string;
  beforeId: string;
}

export interface Sayfa {
  satirlar: Kayit[];
  sonrakiImlec: Imlec | null;
}

const SEKMELER = [
  { deger: '', etiket: 'Hepsi' },
  { deger: 'moderasyon', etiket: 'Moderasyon' },
  { deger: 'erisim', etiket: 'Yetki' },
  { deger: 'oturum', etiket: 'Oturum' },
  { deger: 'okuma', etiket: 'Okuma' },
  { deger: 'sistem', etiket: 'Sistem' },
];

/**
 * Eylem kodunun Türkçe karşılığı.
 *
 * Ekranda 'ban.create' yazsaydı günlüğü ancak kodu yazan okuyabilirdi;
 * oysa asıl okuyacak kişi tartışmanın ortasındaki yetkili.
 */
const EYLEM_ADI: Record<string, string> = {
  'auth.login': 'panele giriş yaptı',
  'auth.logout': 'çıkış yaptı',
  'auth.break_glass': 'acil giriş kullandı',
  'auth.break_glass_failed': 'acil giriş denemesi BAŞARISIZ',
  'access.denied': 'yetkisiz erişim denemesi',
  'ban.create': 'ban attı',
  'ban.revoke': 'banı kaldırdı',
  'ban.enforce': 'banlı oyuncuyu attı',
  'record.create': 'kayıt açtı',
  'record.resolve': 'kaydı kapattı',
  'flag.assign': 'etiket ekledi',
  'flag.remove': 'etiketi kaldırdı',
  'player.kick': 'sunucudan attı',
  'player.warn': 'uyardı',
  'role_mapping.upsert': 'rol eşlemesi yazdı',
  'role_mapping.delete': 'rol eşlemesini sildi',
  'ingame.warn': 'oyun içinden uyardı',
  'ingame.kick': 'oyun içinden attı',
  'ingame.ban': 'oyun içinden banladı',
  'ingame.broadcast': 'sunucu duyurusu',
  'ingame.cam_enter': 'admin kamerasına girdi',
  'ingame.cam_exit': 'admin kamerasından çıktı',
  // Eklentilerin otomatik mesajları — insan kararı değil.
  'ingame.warn_auto': 'otomatik uyarı (eklenti)',
  'ingame.broadcast_auto': 'otomatik duyuru (eklenti)',
  'team_change.now': 'takımını değiştirdi',
  'team_change.scheduled': 'maç sonuna takım değişimi koydu',
  'team_change.executed': 'maç sonu takım değişimi uygulandı',
  'team_change.cancel': 'takım değişimini iptal etti',
  'agent.connect': 'agent bağlandı',
  'agent.disconnect': 'agent koptu',
  'agent.shutdown': 'agent düzgün kapandı',
  'agent.auth_failed': 'agent kimliği REDDEDİLDİ',
  'service.start': 'api başladı',
  'service.stop': 'api kapandı',
  'ban_list.fetch': 'ban listesini çekti',
  'admin_list.fetch': 'admin listesini çekti',
  'http.get': 'görüntüledi',
  'http.post': 'işlem yaptı',
  'http.patch': 'düzenledi',
  'http.delete': 'sildi',
  'http.error': 'sunucu hatası',
};

/**
 * Rota kalıbının okunur karşılığı — genel http satırlarında "neyi"
 * sorusunu cevaplıyor.
 */
const ROTA_ADI: Record<string, string> = {
  '/api/players/search': 'oyuncu araması',
  '/api/players/:id': 'oyuncu profili',
  '/api/players/:id/chat': 'oyuncunun sohbeti',
  '/api/players/:id/coplay': 'birlikte oynadıkları',
  '/api/flags': 'etiket listesi',
  '/api/servers': 'sunucu durumu',
  '/api/role-mappings': 'rol eşlemeleri',
  '/api/activity': 'sistem günlüğü',
  '/api/moderation/bans': 'ban',
  '/api/moderation/records': 'oyuncu kaydı',
};

function eylemMetni(k: Kayit): string {
  const temel = EYLEM_ADI[k.action] ?? k.action;
  if (!k.action.startsWith('http.')) return temel;
  const rota = k.route ? ROTA_ADI[k.route] : undefined;
  return rota ? `${temel}: ${rota}` : `${temel}: ${k.route ?? k.path ?? ''}`;
}

function aktorMetni(k: Kayit): string {
  if (k.actorLabel) return k.actorLabel;
  if (k.actorType === 'game_server') return 'oyun sunucusu';
  if (k.actorType === 'anonymous') return 'kimliksiz';
  if (k.actorType === 'system') return 'sistem';
  return k.actorType;
}

/** Kategoriye göre sol kenar rengi — göz taramada rengi arıyor, metni değil. */
const KATEGORI_RENGI: Record<string, string> = {
  moderasyon: 'bg-danger',
  erisim: 'bg-warn',
  oturum: 'bg-accent',
  okuma: 'bg-border-strong',
  sistem: 'bg-fg-faint',
};

function saat(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function gun(iso: string): string {
  return new Date(iso).toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

export function ActivityLog({
  apiUrl,
  ilkSayfa,
  aktorler,
}: {
  apiUrl: string;
  ilkSayfa: Sayfa;
  aktorler: { id: string; ad: string; adet: number }[];
}) {
  const [satirlar, setSatirlar] = useState<Kayit[]>(ilkSayfa.satirlar);
  const [imlec, setImlec] = useState<Imlec | null>(ilkSayfa.sonrakiImlec);
  const [kategori, setKategori] = useState('');
  const [aktor, setAktor] = useState('');
  const [arama, setArama] = useState('');
  const [yukleniyor, setYukleniyor] = useState(false);
  const [acik, setAcik] = useState<string | null>(null);

  // Filtre değiştiğinde uçan istekler yarışıyor: yavaş olan sonra dönüp
  // yeni filtrenin sonucunu eziyordu. Sıra numarası ile eskimiş cevap
  // atılıyor.
  const surum = useRef(0);

  const getir = useCallback(
    async (devam: Imlec | null, filtreler: { kategori: string; aktor: string; arama: string }) => {
      const benim = ++surum.current;
      setYukleniyor(true);
      const p = new URLSearchParams();
      if (filtreler.kategori) p.set('kategori', filtreler.kategori);
      if (filtreler.aktor) p.set('aktor', filtreler.aktor);
      if (filtreler.arama.trim()) p.set('q', filtreler.arama.trim());
      if (devam) {
        p.set('before', devam.before);
        p.set('beforeId', devam.beforeId);
      }
      try {
        const res = await fetch(`${apiUrl}/activity?${p.toString()}`, { credentials: 'include' });
        if (!res.ok) return;
        const veri = (await res.json()) as Sayfa;
        if (benim !== surum.current) return;
        setSatirlar((eski) => (devam ? [...eski, ...veri.satirlar] : veri.satirlar));
        setImlec(veri.sonrakiImlec);
      } finally {
        if (benim === surum.current) setYukleniyor(false);
      }
    },
    [apiUrl],
  );

  // Arama kutusunda her tuşta istek atmak sunucuyu da listeyi de
  // titretiyordu; 300 ms bekleniyor.
  useEffect(() => {
    const t = setTimeout(() => void getir(null, { kategori, aktor, arama }), 300);
    return () => clearTimeout(t);
  }, [kategori, aktor, arama, getir]);

  let sonGun = '';

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {SEKMELER.map((s) => (
            <button
              key={s.deger}
              type="button"
              onClick={() => setKategori(s.deger)}
              className={cn(
                'rounded-full px-3 py-1.5 text-[13px] transition-colors',
                kategori === s.deger
                  ? 'bg-surface-2 text-fg'
                  : 'text-fg-muted hover:bg-surface hover:text-fg',
              )}
            >
              {s.etiket}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <select
            value={aktor}
            onChange={(e) => setAktor(e.target.value)}
            className="rounded-full border border-border bg-surface px-3 py-1.5 text-[13px] text-fg-muted focus:border-accent focus:outline-none"
          >
            <option value="">Herkes</option>
            {aktorler.map((a) => (
              <option key={a.id} value={a.id}>
                {a.ad} ({a.adet})
              </option>
            ))}
          </select>
          <input
            value={arama}
            onChange={(e) => setArama(e.target.value)}
            placeholder="Ara: isim, eylem, adres"
            className="w-56 rounded-full border border-border bg-surface px-3.5 py-1.5 text-[13px] text-fg placeholder:text-fg-faint focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        {satirlar.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-fg-muted">
            {yukleniyor ? 'Yükleniyor…' : 'Bu filtreyle kayıt yok'}
          </p>
        ) : (
          <ul>
            {satirlar.map((k) => {
              const buGun = gun(k.at);
              const gunBasligi = buGun !== sonGun;
              sonGun = buGun;
              const secili = acik === k.id;
              return (
                <li key={k.id}>
                  {gunBasligi ? (
                    <div className="border-b border-border bg-surface-sunken px-4 py-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-faint">
                      {buGun}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setAcik(secili ? null : k.id)}
                    className="flex w-full items-baseline gap-3 border-b border-border px-4 py-2 text-left text-[13px] hover:bg-surface-2"
                  >
                    <span
                      className={cn(
                        'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                        KATEGORI_RENGI[k.category] ?? 'bg-border-strong',
                      )}
                    />
                    <span className="num w-[62px] shrink-0 text-fg-faint">{saat(k.at)}</span>
                    <span className="w-40 shrink-0 truncate font-medium">{aktorMetni(k)}</span>
                    <span className="min-w-0 flex-1 truncate text-fg-muted">{eylemMetni(k)}</span>
                    {k.targetLabel ? (
                      <span className="num hidden shrink-0 text-fg-faint md:inline">
                        {k.targetLabel}
                      </span>
                    ) : null}
                    {k.statusCode && k.statusCode >= 400 ? (
                      <span className="num shrink-0 text-danger">{k.statusCode}</span>
                    ) : null}
                  </button>

                  {secili ? (
                    <div className="border-b border-border bg-surface-sunken px-4 py-3 text-[12px]">
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-fg-muted">
                        <Satir ad="Eylem kodu" deger={k.action} />
                        <Satir ad="Kategori" deger={k.category} />
                        <Satir ad="Aktör tipi" deger={k.actorType} />
                        {k.method ? (
                          <Satir ad="İstek" deger={`${k.method} ${k.path ?? ''}`} />
                        ) : null}
                        {k.statusCode ? <Satir ad="Yanıt" deger={String(k.statusCode)} /> : null}
                        {k.durationMs !== null ? (
                          <Satir ad="Süre" deger={`${k.durationMs} ms`} />
                        ) : null}
                        {k.ip ? <Satir ad="IP" deger={k.ip} /> : null}
                        {k.targetType ? (
                          <Satir ad="Hedef" deger={`${k.targetType} ${k.targetLabel ?? ''}`} />
                        ) : null}
                        <Satir ad="Zaman" deger={new Date(k.at).toLocaleString('tr-TR')} />
                      </dl>
                      {k.payload ? (
                        <pre className="mt-2 max-h-64 overflow-auto rounded bg-surface p-2.5 text-[11px] leading-relaxed text-fg-muted">
                          {JSON.stringify(k.payload, null, 2)}
                        </pre>
                      ) : null}
                      {k.targetType === 'player' && k.targetId ? (
                        <Link
                          href={`/oyuncular/${k.targetId}`}
                          className="mt-2 inline-block font-semibold text-accent"
                        >
                          Oyuncu profiline git →
                        </Link>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {imlec ? (
        <div className="mt-4 text-center">
          <button
            type="button"
            disabled={yukleniyor}
            onClick={() => void getir(imlec, { kategori, aktor, arama })}
            className="rounded-full border border-border px-4 py-1.5 text-[13px] text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
          >
            {yukleniyor ? '…' : 'Daha eski'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Satir({ ad, deger }: { ad: string; deger: string }) {
  return (
    <>
      <dt className="text-fg-faint">{ad}</dt>
      <dd className="break-all">{deger}</dd>
    </>
  );
}
