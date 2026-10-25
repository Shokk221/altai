import { BmClient, type BmOyuncuAynasi, bmOyuncuAynasi, bmOyuncuBul } from '@altai/bm';
import type { Db } from '@altai/db';
import { identitySchema, moderationSchema } from '@altai/db';
import type { AppConfig } from '@altai/shared';
import { logger } from '@altai/shared';
import { and, eq, notInArray, sql } from 'drizzle-orm';

/**
 * BattleMetrics canlı aynası — plan 5.5-A'nın devamı.
 *
 * NEDEN VAR: arşiv aracı BM'yi bir kez dosyaya döküp bırakmak için
 * yazılmıştı, abonelik iptal edilecekti. İptal olmuyor. Dolayısıyla BM'nin
 * bizde olmayan iki şeyi — oyuncuların ESKİ İSİMLERİ ve yıllardır birikmiş
 * NOTLARI — dondurulmuş bir kopya değil, canlı bir kaynak hâline geliyor.
 *
 * NE YAPMIYOR, bu daha önemli: BM'ye hiçbir şey yazmıyor ve hiçbir yaptırım
 * tetiklemiyor. Kick, ban, flag kararları bu panelde ve bu veritabanında
 * yaşıyor. BM'den okunan banlar `bm_bans` tablosunda duruyor ve ban
 * uygulamasının (uzak ban listesi, ban-enforcer) o tabloya giden hiçbir
 * yolu yok — "BM'de birinin attığı ban bizim sunucumuzda kendiliğinden
 * uygulanmaya başladı" durumu mümkün değil.
 *
 * NASIL TETİKLENİR (ikisi birden):
 *  1. Oyuncu sunucuya girdiğinde (persistence-writer) kuyruğa alınır.
 *     Admin profili açtığında veri çoğunlukla çoktan hazır olur.
 *  2. Admin profili açtığında (routes/players.ts) bayatsa kuyruğa alınır.
 *     İstek BEKLEMEZ: ekran veritabanındakini anında döner, tazelenen veri
 *     bir sonraki açılışta görünür. BM'nin yavaşlığı panelin yavaşlığı
 *     olmamalı.
 */

/** Kuyruk tavanı. Dolu bir sunucu bir anda ~100 oyuncu ekliyor. */
const KUYRUK_TAVANI = 2_000;

/**
 * Başarısız denemeden sonra en erken ne zaman tekrar sorulur.
 *
 * `hata` kısa: geçici bir ağ/BM kesintisi olabilir, bir saat sonra
 * düzelmiş olması muhtemel. `bulunamadi` uzun: oyuncu BM'de gerçekten
 * yoksa her saat sormak kotayı boşa yakar, ama yeni bir oyuncunun BM'de
 * indekslenmesi de zaman alıyor — o yüzden TTL kadar değil, yarısı kadar.
 */
const YENIDEN_DENEME_MS = {
  hata: 60 * 60 * 1000,
  bulunamadi: 6 * 60 * 60 * 1000,
} as const;

interface AynaDurumu {
  db: Db;
  client: BmClient;
  serverIds: string[];
  ttlMs: number;
  /** Sırası korunan bekleme listesi; `bekleyenler` tekilleştirme için. */
  sira: string[];
  bekleyenler: Set<string>;
  calisiyor: boolean;
  durduruldu: boolean;
}

let ayna: AynaDurumu | null = null;

/** Ayna açık mı — rotalar ve yazıcı bunu sormadan kuyruğa yazabilir. */
export function bmAynaAcikMi(): boolean {
  return ayna !== null && !ayna.durduruldu;
}

/**
 * Aynayı başlatır; dönen fonksiyon durdurur.
 *
 * Token yoksa SESSİZCE DEĞİL, bilgi vererek kapalı kalır: "notlar neden
 * gelmiyor" sorusunun cevabı açılış log'unda görünsün.
 */
export function bmSyncBaslat(db: Db, config: AppConfig): () => void {
  if (config.BM_SYNC === 'off') {
    logger.info('BM aynası BM_SYNC=off ile kapalı');
    return () => {};
  }
  if (!config.BATTLEMETRICS_TOKEN) {
    logger.info('BM aynası kapalı — BATTLEMETRICS_TOKEN tanımlı değil');
    return () => {};
  }

  const serverIds = (config.BM_SERVER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (serverIds.length === 0) {
    // Çalışır ama arama BM'nin global veritabanına gider. Uyarı şart:
    // bu, yanlış oyuncu eşleşmesi riskinin arttığı tek ayar.
    logger.warn('BM_SERVER_IDS boş — oyuncu aramasi BM genelinde yapılacak');
  }

  ayna = {
    db,
    client: new BmClient({
      token: config.BATTLEMETRICS_TOKEN,
      requestsPerSecond: config.BM_SYNC_RPS,
    }),
    serverIds,
    ttlMs: config.BM_SYNC_TTL_HOURS * 60 * 60 * 1000,
    sira: [],
    bekleyenler: new Set(),
    calisiyor: false,
    durduruldu: false,
  };

  logger.info(
    {
      sunucu: serverIds.length,
      ttlSaat: config.BM_SYNC_TTL_HOURS,
      rps: config.BM_SYNC_RPS,
    },
    'BM aynası açık (salt okunur)',
  );

  return () => {
    if (ayna) ayna.durduruldu = true;
    ayna = null;
  };
}

/**
 * Oyuncuyu tazeleme kuyruğuna alır. Ayna kapalıysa hiçbir şey yapmaz.
 *
 * Bayatlık burada DEĞİL, işçide kontrol ediliyor: kuyruğa almak bir
 * veritabanı sorgusu kadar bile sürmesin istiyoruz — bu fonksiyon oyuncu
 * girişi gibi sıcak yollardan çağrılıyor.
 */
export function bmKuyrugaAl(playerId: string): void {
  if (!ayna || ayna.durduruldu) return;
  if (ayna.bekleyenler.has(playerId)) return;
  if (ayna.sira.length >= KUYRUK_TAVANI) {
    logger.warn({ tavan: KUYRUK_TAVANI }, 'BM ayna kuyruğu dolu — oyuncu atlandı');
    return;
  }
  ayna.sira.push(playerId);
  ayna.bekleyenler.add(playerId);
  void isciyiDurtle();
}

/** Kuyruğu tek işçiyle, sırayla boşaltır. */
async function isciyiDurtle(): Promise<void> {
  const durum = ayna;
  if (!durum || durum.calisiyor) return;
  durum.calisiyor = true;

  try {
    for (;;) {
      if (durum.durduruldu) return;
      const playerId = durum.sira.shift();
      if (!playerId) return;
      durum.bekleyenler.delete(playerId);

      try {
        await bmTazele(durum.db, playerId);
      } catch (err) {
        // Tek oyuncunun hatası kuyruğu durdurmamalı; durumu zaten
        // bm_sync_state'e 'hata' olarak yazıldı.
        logger.error({ err, playerId }, 'BM ayna tazelemesi başarısız');
      }
    }
  } finally {
    durum.calisiyor = false;
  }
}

export interface TazeleSonucu {
  durum: 'ok' | 'bulunamadi' | 'hata' | 'bayat_degil' | 'kapali';
  isim?: number;
  not?: number;
  ban?: number;
}

/**
 * Bir oyuncunun BM verisini okur ve veritabanına yazar.
 *
 * `zorla` yalnızca panelden "BM'den tazele" düğmesi için: TTL'i yok sayar.
 * Kuyruk bunu kullanmıyor, yoksa dolu bir sunucuda aynı oyuncular her
 * girişte yeniden sorulurdu.
 */
export async function bmTazele(
  db: Db,
  playerId: string,
  opts: { zorla?: boolean } = {},
): Promise<TazeleSonucu> {
  const durum = ayna;
  if (!durum) return { durum: 'kapali' };

  const [oyuncu] = await db
    .select({
      id: identitySchema.players.id,
      steamId: identitySchema.players.steamId,
      eosId: identitySchema.players.eosId,
      battlemetricsId: identitySchema.players.battlemetricsId,
    })
    .from(identitySchema.players)
    .where(eq(identitySchema.players.id, playerId))
    .limit(1);
  if (!oyuncu) return { durum: 'hata' };

  const [mevcut] = await db
    .select()
    .from(identitySchema.bmSyncState)
    .where(eq(identitySchema.bmSyncState.playerId, playerId))
    .limit(1);

  if (!opts.zorla && mevcut && !bayatMi(mevcut, durum.ttlMs)) {
    return { durum: 'bayat_degil' };
  }

  try {
    // Arşiv importu `players.battlemetrics_id`'yi 111 bin oyuncu için
    // doldurdu; onlarda arama isteğini hiç atmıyoruz. Üç istekten biri
    // böylece ortadan kalkıyor.
    const bmPlayerId =
      mevcut?.bmPlayerId ??
      oyuncu.battlemetricsId ??
      (await bmOyuncuBul(
        durum.client,
        { steamId: oyuncu.steamId, eosId: oyuncu.eosId },
        durum.serverIds.length > 0 ? { serverIds: durum.serverIds } : {},
      ));

    if (!bmPlayerId) {
      await durumYaz(db, playerId, { bmPlayerId: null, status: 'bulunamadi', error: null });
      return { durum: 'bulunamadi' };
    }

    const veri = await bmOyuncuAynasi(durum.client, bmPlayerId);
    const yazilan = await aynayiYaz(db, playerId, veri);

    await durumYaz(db, playerId, {
      bmPlayerId,
      status: 'ok',
      error: null,
      erisilemeyen: veri.erisilemeyen,
      sunucular: veri.sunucular.map((s) => ({
        bmServerId: s.bmServerId,
        serverName: s.serverName,
        timePlayed: s.timePlayed,
        firstSeen: s.firstSeen?.toISOString() ?? null,
        lastSeen: s.lastSeen?.toISOString() ?? null,
      })),
    });

    // `players.battlemetrics_id` BOŞSA dolduruluyor, dolu ise ASLA
    // ezilmiyor: o alan arşiv importunun ürünü ve ikisi ayrışırsa (BM
    // hesap birleştirdiğinde oluyor) bunu `bm_sync_state` üzerinden
    // görmek istiyoruz, sessizce üzerine yazmak istemiyoruz.
    if (!oyuncu.battlemetricsId) {
      // KENDİ try'ı var ve hatası YUTULUYOR. `players.battlemetrics_id`
      // tekil bir kolon; BM iki hesabı birleştirdiğinde iki oyuncu
      // satırımız aynı BM id'sine çözülebiliyor ve ikincisi tekillik
      // hatası veriyor. Bu hatanın dışarı çıkması, az önce başarıyla
      // yazılmış aynayı 'hata' olarak işaretleyip saat başı yeniden
      // denemeye sokardı — oysa asıl iş bitti, eksik kalan yalnızca
      // eski bir kolonun geri doldurulması.
      try {
        await db
          .update(identitySchema.players)
          .set({ battlemetricsId: bmPlayerId })
          .where(and(eq(identitySchema.players.id, playerId), sql`battlemetrics_id is null`));
      } catch (err) {
        logger.warn(
          { err, playerId, bmPlayerId },
          'players.battlemetrics_id doldurulamadı — ayna yazıldı, bu kolon atlandı',
        );
      }
    }

    return { durum: 'ok', ...yazilan };
  } catch (err) {
    await durumYaz(db, playerId, {
      bmPlayerId: mevcut?.bmPlayerId ?? oyuncu.battlemetricsId ?? null,
      status: 'hata',
      error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
    });
    throw err;
  }
}

/**
 * Bayatlık kararı.
 *
 * Başarılı okuma `synced_at`'e, yeniden deneme hakkı `attempted_at`'e
 * bakıyor. İkisini tek alana indirmek, sürekli hata veren bir oyuncu için
 * her tetiklemede BM'ye gitmek demekti.
 */
export function bayatMi(
  satir: { syncedAt: Date | null; attemptedAt: Date; status: string },
  ttlMs: number,
  simdi: Date = new Date(),
): boolean {
  const gecen = simdi.getTime() - satir.attemptedAt.getTime();

  if (satir.status === 'hata') return gecen >= YENIDEN_DENEME_MS.hata;
  if (satir.status === 'bulunamadi') return gecen >= YENIDEN_DENEME_MS.bulunamadi;
  if (!satir.syncedAt) return true;
  return simdi.getTime() - satir.syncedAt.getTime() >= ttlMs;
}

async function durumYaz(
  db: Db,
  playerId: string,
  veri: {
    bmPlayerId: string | null;
    status: 'ok' | 'bulunamadi' | 'hata';
    error: string | null;
    erisilemeyen?: string[];
    sunucular?: typeof identitySchema.bmSyncState.$inferInsert.sunucular;
  },
): Promise<void> {
  const simdi = new Date();
  const satir = {
    playerId,
    bmPlayerId: veri.bmPlayerId,
    status: veri.status,
    error: veri.error,
    attemptedAt: simdi,
    // `synced_at` yalnızca BAŞARIDA ilerliyor: hata durumunda eski başarılı
    // okumanın zamanı korunmalı, yoksa "bu veri ne kadar eski" sorusunun
    // cevabı kaybolur.
    ...(veri.status === 'ok' ? { syncedAt: simdi } : {}),
    ...(veri.erisilemeyen ? { erisilemeyen: veri.erisilemeyen } : {}),
    ...(veri.sunucular ? { sunucular: veri.sunucular } : {}),
  };

  await db
    .insert(identitySchema.bmSyncState)
    .values(satir)
    .onConflictDoUpdate({ target: identitySchema.bmSyncState.playerId, set: satir });
}

/**
 * Okunan BM verisini tablolara yazar.
 *
 * İsim ve not SİLİNMİYOR, yalnızca ekleniyor/güncelleniyor — moderasyon
 * geçmişi kaybolmamalı (şemanın her yerindeki kural). Ban ise tam ayna:
 * BM'de kaldırılmış bir ban panelde durmaya devam etseydi, moderatör
 * olmayan bir yaptırıma bakıp karar verirdi.
 */
async function aynayiYaz(
  db: Db,
  playerId: string,
  veri: BmOyuncuAynasi,
): Promise<{ isim: number; not: number; ban: number }> {
  // --- İsimler ---
  if (veri.isimler.length > 0) {
    await db
      .insert(identitySchema.playerNames)
      .values(
        veri.isimler.map((i) => ({
          playerId,
          name: i.name,
          firstSeen: i.firstSeen,
          lastSeen: i.lastSeen,
          source: 'battlemetrics',
          // `external_id` BİLEREK yazılmıyor. O kolon tekil ve BM aynı ismi
          // farklı kayıt kimlikleriyle bildiriyor; yazmak, ismi zaten
          // içeri almış arşiv satırıyla tekillik çakışması üretirdi.
          // Arşiv importunun notu: external_id tekillik anahtarı DEĞİL.
        })),
      )
      .onConflictDoUpdate({
        target: [identitySchema.playerNames.playerId, identitySchema.playerNames.name],
        set: {
          // Aralık yalnızca GENİŞLER. `least/greatest` null'ı yok sayar,
          // yani elimizdeki tek taraflı bilgi diğerini silmez.
          firstSeen: sql`least(${identitySchema.playerNames.firstSeen}, excluded.first_seen)`,
          lastSeen: sql`greatest(${identitySchema.playerNames.lastSeen}, excluded.last_seen)`,
          // `source` DOKUNULMUYOR: ismi kendimiz görmüşsek o kayıt 'altai'
          // kalmalı, BM'nin de bilmesi onu BM kaydına çevirmez.
        },
      });
  }

  // --- Notlar ---
  // (source, external_id) tekil; aynı not tekrar okunduğunda güncellenir.
  // `resolved_at` DOKUNULMUYOR: bir moderatör notu panelde arşivlemişse
  // her tazeleme onu geri açardı.
  if (veri.notlar.length > 0) {
    await db
      .insert(moderationSchema.playerRecords)
      .values(
        veri.notlar.map((n) => ({
          playerId,
          kind: 'note' as const,
          body: n.body,
          authorName: n.authorName,
          createdAt: n.createdAt ?? new Date(),
          updatedAt: n.updatedAt,
          source: 'battlemetrics' as const,
          externalId: n.externalId,
        })),
      )
      .onConflictDoUpdate({
        target: [moderationSchema.playerRecords.source, moderationSchema.playerRecords.externalId],
        set: {
          body: sql`excluded.body`,
          authorName: sql`excluded.author_name`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  // --- Banlar (yalnızca gösterim) ---
  const banlariOkuduk = !veri.erisilemeyen.includes('banlar');
  if (veri.banlar.length > 0) {
    await db
      .insert(moderationSchema.bmBans)
      .values(
        veri.banlar.map((b) => ({
          playerId,
          externalId: b.externalId,
          reason: b.reason,
          note: b.note,
          expiresAt: b.expiresAt,
          issuedAt: b.createdAt,
          issuedByName: b.issuedByName,
          banListName: b.banListName,
          syncedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: moderationSchema.bmBans.externalId,
        set: {
          reason: sql`excluded.reason`,
          note: sql`excluded.note`,
          expiresAt: sql`excluded.expires_at`,
          issuedByName: sql`excluded.issued_by_name`,
          banListName: sql`excluded.ban_list_name`,
          syncedAt: sql`excluded.synced_at`,
        },
      });
  }

  // BM'den kaldırılan banları aynadan düşür — AMA yalnızca ban listesini
  // gerçekten okuyabildiysek. 403 alıp boş liste dönmüşken silmek, yetki
  // kaybının oyuncunun sicilini temize çıkarması olurdu.
  if (banlariOkuduk) {
    const kalanlar = veri.banlar.map((b) => b.externalId);
    await db
      .delete(moderationSchema.bmBans)
      .where(
        kalanlar.length > 0
          ? and(
              eq(moderationSchema.bmBans.playerId, playerId),
              notInArray(moderationSchema.bmBans.externalId, kalanlar),
            )
          : eq(moderationSchema.bmBans.playerId, playerId),
      );
  }

  return { isim: veri.isimler.length, not: veri.notlar.length, ban: veri.banlar.length };
}

/**
 * Profil ekranının ihtiyacı: ayna durumu + BM'deki banlar + BM süresi.
 *
 * Ayna kapalı olsa bile çalışıyor — tablodaki son okuma yine gösterilmeli,
 * "BM verisi şu tarihte alınmış" bilgisi aynanın açık olmasından bağımsız.
 */
export async function bmProfilVerisi(db: Db, playerId: string) {
  const [[satir], banlar] = await Promise.all([
    db
      .select()
      .from(identitySchema.bmSyncState)
      .where(eq(identitySchema.bmSyncState.playerId, playerId))
      .limit(1),
    db
      .select()
      .from(moderationSchema.bmBans)
      .where(eq(moderationSchema.bmBans.playerId, playerId))
      .orderBy(
        sql`coalesce(${moderationSchema.bmBans.issuedAt}, ${moderationSchema.bmBans.syncedAt}) desc`,
      ),
  ]);

  return {
    acik: bmAynaAcikMi(),
    bmPlayerId: satir?.bmPlayerId ?? null,
    syncedAt: satir?.syncedAt ?? null,
    status: satir?.status ?? null,
    erisilemeyen: satir?.erisilemeyen ?? [],
    sunucular: satir?.sunucular ?? [],
    banlar,
  };
}

/**
 * Profil açılışında çağrılır: bayatsa kuyruğa alır, İSTEĞİ BEKLETMEZ.
 *
 * Bayatlık burada bir kez sorgulanıyor çünkü alternatif, her profil
 * açılışını kuyruğa yazmak ve işçinin onu eleyene kadar yer tutmasıydı.
 */
export async function bmProfilAcildi(db: Db, playerId: string): Promise<void> {
  const durum = ayna;
  if (!durum || durum.durduruldu) return;

  const [satir] = await db
    .select({
      syncedAt: identitySchema.bmSyncState.syncedAt,
      attemptedAt: identitySchema.bmSyncState.attemptedAt,
      status: identitySchema.bmSyncState.status,
    })
    .from(identitySchema.bmSyncState)
    .where(eq(identitySchema.bmSyncState.playerId, playerId))
    .limit(1);

  if (!satir || bayatMi(satir, durum.ttlMs)) bmKuyrugaAl(playerId);
}
