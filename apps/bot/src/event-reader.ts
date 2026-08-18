import type { AgentEvent } from '@altai/contracts';
import { AgentEvent as AgentEventSchema } from '@altai/contracts';
import type { Db } from '@altai/db';
import { presenceSchema } from '@altai/db';
import { logger } from '@altai/shared';
import { and, asc, desc, gt, inArray } from 'drizzle-orm';

/**
 * Bot'un olay kaynağı: `raw_events` tablosundan sırayla okuma.
 *
 * Neden WebSocket değil? Panelin canlı akışı oturum çerezine dayanıyor ve
 * yalnızca beş olay türünü taşıyor (giriş/çıkış/manga/sohbet/yetkili);
 * killfeed'in ihtiyacı olan TEAMKILL orada yok. Bot'a ayrı bir kimlikli WS
 * ucu açmak yeni bir yetki yüzeyi demekti — oysa bot zaten rol senkronu
 * için veritabanına bağlı, o sınır çoktan geçilmiş.
 *
 * BAŞLANGIÇTA GEÇMİŞ OKUNMUYOR. İmleç "şimdi"den başlıyor. Aksi hâlde bot
 * her yeniden başlatıldığında saatlerce birikmiş killfeed Discord'a
 * boşalırdı — kapalı kaldığı sürede birkaç olayı kaçırmak buna kıyasla
 * çok ucuz.
 */

export interface OlayOkuyucuSecenekleri {
  db: Db;
  /** Yalnızca bu türler okunuyor — gerisi bot'u ilgilendirmiyor. */
  turler: string[];
  /** Kaç ms'de bir yoklanır. */
  aralikMs?: number;
  /** Tek turda en fazla kaç satır. */
  sayfaBoyutu?: number;
  /** Doğrulanmış olay + hangi sunucudan geldiği. */
  isle: (event: AgentEvent, serverId: string) => void | Promise<void>;
}

export interface OlayOkuyucu {
  /** Bir tur çalıştırır. Testler bunu doğrudan çağırıyor. */
  tur(): Promise<number>;
  baslat(): void;
  durdur(): void;
}

const VARSAYILAN_ARALIK_MS = 2_000;
const VARSAYILAN_SAYFA = 200;

export function createOlayOkuyucu(opts: OlayOkuyucuSecenekleri): OlayOkuyucu {
  const aralik = opts.aralikMs ?? VARSAYILAN_ARALIK_MS;
  const sayfa = opts.sayfaBoyutu ?? VARSAYILAN_SAYFA;

  /**
   * İmleç: bu sıra numarasından SONRAKİ satırlar okunacak.
   *
   * Zaman damgası imleç olarak KULLANILMIYOR ve bu bir hata sonucu
   * öğrenildi: Postgres `timestamptz`'i mikrosaniye tutuyor, JS `Date`
   * milisaniyeye yuvarlıyor. İmleç `...970` olarak saklanınca `...970123`
   * satırı her turda "daha yeni" görünüyor ve aynı olaylar sonsuza kadar
   * yeniden okunuyordu — Discord'a her yoklamada aynı killfeed düşerdi.
   *
   * `-1` = henüz ilklendirilmedi; ilk turda tablonun sonuna konumlanıyor.
   */
  let imlec = -1;
  let zamanlayici: ReturnType<typeof setInterval> | undefined;
  let calisiyor = false;

  /** İmleci tablonun SONUNA koyar: açılışta geçmiş okunmuyor. */
  async function imleciBaslat() {
    const [son] = await opts.db
      .select({ seq: presenceSchema.rawEvents.seq })
      .from(presenceSchema.rawEvents)
      .orderBy(desc(presenceSchema.rawEvents.seq))
      .limit(1);
    imlec = son?.seq ?? 0;
  }

  async function tur(): Promise<number> {
    // Önceki tur bitmeden ikincisi başlarsa aynı satırlar iki kez
    // işlenir ve Discord'a çift mesaj düşer.
    if (calisiyor) return 0;
    calisiyor = true;
    try {
      if (imlec < 0) await imleciBaslat();

      const satirlar = await opts.db
        .select({
          id: presenceSchema.rawEvents.id,
          seq: presenceSchema.rawEvents.seq,
          serverId: presenceSchema.rawEvents.serverId,
          payload: presenceSchema.rawEvents.payload,
        })
        .from(presenceSchema.rawEvents)
        .where(
          and(
            gt(presenceSchema.rawEvents.seq, imlec),
            inArray(presenceSchema.rawEvents.eventType, opts.turler),
          ),
        )
        .orderBy(asc(presenceSchema.rawEvents.seq))
        .limit(sayfa);

      let islenen = 0;
      for (const satir of satirlar) {
        // İmleç HER satırda ilerletiliyor, işleme başarılı olmasa bile:
        // bozuk tek bir satır yüzünden okuyucunun sonsuza kadar aynı
        // yerde takılması, bütün akışı durdurmak demek.
        imlec = satir.seq;

        const sonuc = AgentEventSchema.safeParse(satir.payload);
        if (!sonuc.success) {
          // Sözleşmeye uymayan satır: olay şeması değişmiş ya da eski bir
          // kayıt olabilir. Sessizce atlamak, "killfeed neden çalışmıyor"
          // sorusunu cevapsız bırakırdı.
          logger.warn(
            { id: satir.id, hata: sonuc.error.issues.slice(0, 2) },
            'olay doğrulanamadı — atlandı',
          );
          continue;
        }

        try {
          await opts.isle(sonuc.data, satir.serverId);
          islenen++;
        } catch (err) {
          // Bir olayın render'ı patlarsa diğerleri işlenmeye devam etsin.
          logger.error({ err, tur: sonuc.data.type }, 'olay işlenemedi');
        }
      }

      return islenen;
    } catch (err) {
      // Veritabanı okunamadı: imleç İLERLETİLMİYOR, bir sonraki tur aynı
      // yerden devam ediyor.
      logger.error({ err }, 'olaylar okunamadı');
      return 0;
    } finally {
      calisiyor = false;
    }
  }

  return {
    tur,
    baslat() {
      if (zamanlayici) return;
      zamanlayici = setInterval(() => void tur(), aralik);
      zamanlayici.unref?.();
      logger.info({ aralikMs: aralik, turler: opts.turler }, 'olay okuyucu başladı');
    },
    durdur() {
      if (zamanlayici) clearInterval(zamanlayici);
      zamanlayici = undefined;
    },
  };
}
