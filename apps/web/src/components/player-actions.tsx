'use client';

import type { Kural } from '@/components/kurallar';
import { BanKaldirPenceresi } from '@/components/oyuncu/ban-kaldir-penceresi';
import { BanPenceresi } from '@/components/oyuncu/ban-penceresi';
import { KayitPenceresi, type KayitTuru } from '@/components/oyuncu/kayit-penceresi';
import { Button } from '@/components/ui/button';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';

/**
 * Oyuncu profilindeki yazma eylemleri.
 *
 * Eylemler künye bandının içinde duruyor ve kapalıyken TEK SATIR yer
 * kaplıyor. İlk sürümde ban formu ve not formu ayrı ayrı, sürekli açık
 * bloklardı; sayfanın yarısını doldurup asıl bilgiyi ekrandan itiyorlardı.
 *
 * Her eylem hatasını kendi yanında gösteriyor: tek bir üst bölgede toplamak
 * hangi işlemin başarısız olduğunu belirsiz bırakıyordu.
 */

const API_HATALARI: Record<string, string> = {
  gecersiz_girdi: 'Girdi geçersiz',
  oyuncu_bulunamadi: 'Oyuncu bulunamadı',
  ban_bulunamadi: 'Ban bulunamadı',
  ban_zaten_kaldirilmis: 'Bu ban zaten kaldırılmış',
  flag_zaten_atanmis: 'Bu etiket zaten atanmış',
  sl_ban_zaten_var: 'Bu oyuncunun zaten aktif bir SL banı var',
  sl_ban_etiketi_cozulemedi: 'SL ban etiketi bulunamadı, yöneticiye bildirin',
  acik_kayit_bulunamadi: 'Açık kayıt bulunamadı',
  bitis_gecmiste: 'Bitiş tarihi geçmişte olamaz',
  forbidden: 'Bu işlem için yetkiniz yok',
  no_session: 'Oturum bulunamadı, tekrar giriş yapın',
  invalid_session: 'Oturum geçersiz, tekrar giriş yapın',
  // BM aynası kapalıyken ya da BM'ye ulaşılamazken: ikisi AYRI mesaj,
  // çünkü biri bizim ayarımız (token yok), diğeri BM tarafı. Tek mesaja
  // indirmek, admini yanlış yerde hata aramaya gönderirdi.
  bm_aynasi_kapali: 'BM aynası kapalı (token tanımlı değil)',
  bm_erisilemedi: 'BattleMetrics’e ulaşılamadı',
};

function mesaj(kod: unknown, detay?: unknown): string {
  const k = typeof kod === 'string' ? kod : '';
  const temel = API_HATALARI[k] ?? k ?? 'Beklenmeyen hata';
  return typeof detay === 'string' && detay ? `${temel}: ${detay}` : temel;
}

function useEylem(apiUrl: string) {
  const router = useRouter();
  const [bekliyor, setBekliyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  async function calistir(yol: string, govde?: unknown): Promise<boolean> {
    setBekliyor(true);
    setHata(null);
    try {
      const res = await fetch(`${apiUrl}${yol}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(govde ?? {}),
      });
      if (!res.ok) {
        const g = (await res.json().catch(() => ({}))) as { error?: unknown; detay?: unknown };
        setHata(mesaj(g.error, g.detay));
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setHata('Sunucuya ulaşılamadı');
      return false;
    } finally {
      setBekliyor(false);
    }
  }

  return { calistir, bekliyor, hata, temizle: () => setHata(null) };
}

function Hata({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="mt-2 text-xs font-medium text-danger">{children}</p>;
}

const KAYIT_ETIKET: Record<'note' | 'warning' | 'watchlist', string> = {
  note: 'Not',
  warning: 'Uyarı',
  watchlist: 'Takip',
};

/**
 * Eylem çubuğu — düğmeler, PENCERE açıyor.
 *
 * ÖNCESİ: düğmeye basınca aynı yerde tek satırlık bir form beliriyordu.
 * Üç sorunu vardı. Form açılınca sayfanın düzeni kayıyor, moderatörün
 * az önce okuduğu satır aşağı itiliyordu. Ban sebebi tek satırlık bir
 * `input`'tu: bir olayı anlatmak oraya sığmıyordu. Ve sebep SERBEST
 * METİNDİ — aynı ihlal "tk", "TK yaptı", "takım arkadaşını öldürdü"
 * diye dört ayrı kayıtla duruyordu, itiraz geldiğinde hangi kurala
 * dayandığı belirsizdi.
 *
 * Artık her eylem kendi penceresinde ve ban bir kurala bağlanmadan
 * atılamıyor (bkz. ban-penceresi.tsx).
 */
export function HizliEylemler({
  apiUrl,
  playerId,
  playerAdi,
  kurallar,
  banlayabilir,
  notYazabilir,
}: {
  apiUrl: string;
  playerId: string;
  /** Pencere başlığında geçiyor: hangi oyuncuya işlem yapıldığı belli olsun. */
  playerAdi: string;
  /** Ban penceresi bunlardan birini seçmeye zorluyor. */
  kurallar: Kural[];
  banlayabilir: boolean;
  notYazabilir: boolean;
}) {
  const { calistir, bekliyor, hata, temizle } = useEylem(apiUrl);
  const [banAcik, setBanAcik] = useState(false);
  const [kayitTuru, setKayitTuru] = useState<KayitTuru | null>(null);

  function kapat() {
    setBanAcik(false);
    setKayitTuru(null);
    temizle();
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {banlayabilir ? (
          <Button variant="danger" size="sm" onClick={() => setBanAcik(true)}>
            Ban at
          </Button>
        ) : null}
        {notYazabilir
          ? (['note', 'warning', 'watchlist'] as const).map((k) => (
              <Button key={k} variant="soft" size="sm" onClick={() => setKayitTuru(k)}>
                {KAYIT_ETIKET[k]} ekle
              </Button>
            ))
          : null}
      </div>

      {banlayabilir ? (
        <BanPenceresi
          acik={banAcik}
          onKapat={kapat}
          kurallar={kurallar}
          oyuncuAdi={playerAdi}
          bekliyor={bekliyor}
          hata={hata}
          onGonder={async ({ tur, ...govde }) => {
            // İki ayrı uç: SL ban oyuncuyu sunucudan atmıyor, `bans`
            // tablosuna da düşmüyor (oraya düşen kayıt ban listesine ve
            // giriş kickine karışırdı). `tur` gövdeden ayrılıyor; ban ucu
            // onu tanımıyor.
            const ok =
              tur === 'sl'
                ? await calistir(`/players/${playerId}/sl-ban`, {
                    reason: govde.reason,
                    expiresAt: govde.expiresAt,
                  })
                : await calistir(`/players/${playerId}/bans`, govde);
            if (ok) kapat();
          }}
        />
      ) : null}

      {notYazabilir && kayitTuru ? (
        <KayitPenceresi
          acik
          onKapat={kapat}
          ilkTur={kayitTuru}
          kurallar={kurallar}
          oyuncuAdi={playerAdi}
          bekliyor={bekliyor}
          hata={hata}
          onGonder={async (veri) => {
            const ok = await calistir(`/players/${playerId}/records`, veri);
            if (ok) kapat();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Banı kaldır — PENCERE açıyor, gerekçe soruyor.
 *
 * Önce tek tıkta çalışıyordu: onay da yoktu gerekçe de. Yanlışlıkla
 * basmak geri alınamıyor (api ikinci kaldırmayı reddediyor, ilk
 * kaldıranın kaydını korumak için) ve "bu ban neden düştü" sorusunun
 * cevabı hiçbir yerde kalmıyordu.
 */
export function BanKaldir({ apiUrl, banId }: { apiUrl: string; banId: string }) {
  const { calistir, bekliyor, hata, temizle } = useEylem(apiUrl);
  const [acik, setAcik] = useState(false);

  function kapat() {
    setAcik(false);
    temizle();
  }

  return (
    <>
      <Button variant="soft" size="sm" onClick={() => setAcik(true)}>
        Banı kaldır
      </Button>
      <BanKaldirPenceresi
        acik={acik}
        onKapat={kapat}
        bekliyor={bekliyor}
        hata={hata}
        onGonder={async (gerekce) => {
          const ok = await calistir(`/bans/${banId}/revoke`, { reason: gerekce });
          if (ok) kapat();
        }}
      />
    </>
  );
}

export function KaydiKapat({ apiUrl, recordId }: { apiUrl: string; recordId: string }) {
  const { calistir, bekliyor, hata } = useEylem(apiUrl);
  return (
    <div>
      <button
        type="button"
        onClick={() => calistir(`/records/${recordId}/resolve`)}
        disabled={bekliyor}
        className="text-2xs font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
      >
        {bekliyor ? '…' : 'kapat'}
      </button>
      <Hata>{hata}</Hata>
    </div>
  );
}

export function EtiketKaldir({ apiUrl, atamaId }: { apiUrl: string; atamaId: string }) {
  const { calistir, bekliyor } = useEylem(apiUrl);
  return (
    <button
      type="button"
      onClick={() => calistir(`/flag-assignments/${atamaId}/remove`)}
      disabled={bekliyor}
      className="text-fg-muted transition-colors hover:text-danger disabled:opacity-40"
      aria-label="Etiketi kaldır"
    >
      ×
    </button>
  );
}

/**
 * "BM'den tazele" — oyuncunun BattleMetrics verisini şimdi yeniden okur.
 *
 * Ayna normalde kendi kendine çalışıyor (oyuncu girince + profil açılınca
 * bayatsa). Bu düğme TTL'i yok saymak için: adminin BM'de az önce yazdığı
 * bir notu panelde hemen görmek istediği durum.
 *
 * Künye bandındaki soluk metnin içinde duruyor, Button DEĞİL: orada bir
 * düğme kutusu, yanındaki "ilk/son görülme" satırlarının hizasını bozuyor
 * ve okunması gereken bilgiden daha çok dikkat çekiyordu.
 */
export function BmTazele({ apiUrl, playerId }: { apiUrl: string; playerId: string }) {
  const { calistir, bekliyor, hata } = useEylem(apiUrl);
  return (
    <>
      <button
        type="button"
        onClick={() => calistir(`/players/${playerId}/bm-tazele`)}
        disabled={bekliyor}
        className="font-medium text-fg-muted underline-offset-2 transition-colors hover:text-fg hover:underline disabled:opacity-40"
      >
        {bekliyor ? 'BM okunuyor…' : 'BM’den tazele'}
      </button>
      <Hata>{hata}</Hata>
    </>
  );
}
