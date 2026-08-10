import { OnlinePlayers } from '@altai/contracts';
import type { Db } from '@altai/db';
import { identitySchema, moderationSchema, presenceSchema } from '@altai/db';
import { logger } from '@altai/shared';
import { and, eq, isNull, or } from 'drizzle-orm';
import { agentBagliMi, komutGonder } from './agent-command-bus.js';
import { aktifBanKosulu } from './ban-active.js';

/**
 * Ban uygulaması — RCON üzerinden canlı denetim.
 *
 * Eski model, Squad'ın uzak ban listesiydi: sunucu periyodik olarak bir .cfg
 * çekiyor ve engellemeyi kendisi yapıyordu. Bu modelin can sıkıcı tarafı BAN
 * KALDIRMAKTI — oyuncu affedilse bile sunucu listeyi yeniden çekene kadar
 * giremiyordu.
 *
 * Bu model bunun yerine anlık davranıyor:
 *
 *   1. Oyuncu girer girmez kontrol edilir (PLAYER_CONNECTED olayı).
 *   2. Ayrıca 60 saniyede bir sunucudaki tüm oyuncular taranır. Tarama şart:
 *      birinci adım agent kopukken kaçırılmış olabilir, ya da oyuncu zaten
 *      içerideyken ban yemiş olabilir.
 *
 * Ban kaldırıldığı an oyuncu girebilir; hiçbir yerde önbelleklenmiş liste yok.
 *
 * TAKAS — bu modelde uygulama panele bağımlı. api ya da agent çökerse hiçbir
 * ban uygulanmaz; .cfg listesi ise sunucunun kendi içinde çalışıyordu ve biz
 * kapalıyken de koruyordu. Uç (routes/ban-list.ts) yerinde duruyor: sunucu
 * yapılandırmasında bırakılırsa ikisi birlikte çalışır, taban koruma .cfg,
 * anlık katman RCON olur. Sadece kaldırma o zaman listenin yenilenme
 * aralığı kadar gecikir.
 */

const TARAMA_ARALIGI_MS = 60_000;

/**
 * Çalışma kipi. 'dry' gerçek oyuncuları atmadan neyin atılacağını gösterir;
 * uygulama dondurulmuş bir BM arşivine dayandığı için bu güvenlik valfi
 * gerekli. Kip süreç ömrü boyunca sabit — env'den okunur.
 */
let kip: 'on' | 'dry' | 'off' = 'on';
export function kipiAyarla(yeni: 'on' | 'dry' | 'off') {
  kip = yeni;
}

export interface BanliOyuncu {
  playerId: string;
  steamId: string | null;
  eosId: string | null;
  reason: string;
}

export interface OnlineKimlik {
  steamId: string | null;
  eosId: string | null;
}

/**
 * Sunucudaki oyuncularla aktif banları kimlik üzerinden eşleştirir.
 *
 * İsimle değil kimlikle: oyuncu adı her an değişebilir. EOS karşılaştırması
 * KÜÇÜK HARFE indirgenerek yapılıyor — veritabanında küçük harf saklıyoruz
 * ama RCON büyük harf döndürebilir ve o zaman banlı oyuncu sessizce
 * eşleşmez, yani ban hiç uygulanmaz.
 *
 * Ayrı fonksiyon ve saf: veritabanı olmadan test edilebilsin.
 */
export function banliOlanlar(online: OnlineKimlik[], banlilar: BanliOyuncu[]): BanliOyuncu[] {
  if (online.length === 0 || banlilar.length === 0) return [];

  const steamIle = new Map<string, BanliOyuncu>();
  const eosIle = new Map<string, BanliOyuncu>();
  for (const b of banlilar) {
    if (b.steamId) steamIle.set(b.steamId, b);
    if (b.eosId) eosIle.set(b.eosId.toLowerCase(), b);
  }

  const bulunan: BanliOyuncu[] = [];
  const gorulen = new Set<string>();
  for (const o of online) {
    const ban =
      (o.steamId ? steamIle.get(o.steamId) : undefined) ??
      (o.eosId ? eosIle.get(o.eosId.toLowerCase()) : undefined);
    // Aynı oyuncu iki kimlikle eşleşirse iki kez atmaya çalışmayalım.
    if (ban && !gorulen.has(ban.playerId)) {
      gorulen.add(ban.playerId);
      bulunan.push(ban);
    }
  }
  return bulunan;
}

/**
 * Verilen sunucuda geçerli olan aktif banları kimlikleriyle getirir.
 *
 * Sunucu kapsamı: `server_id` NULL olan ban her yerde geçerli, dolu olan
 * yalnızca kendi sunucusunda. Kapsamı yok saymak, turnuva sunucusundan
 * yasaklanan birinin ana sunucudan da atılması demekti.
 */
async function aktifBanlar(db: Db, serverId: string): Promise<BanliOyuncu[]> {
  return db
    .select({
      playerId: moderationSchema.bans.playerId,
      steamId: identitySchema.players.steamId,
      eosId: identitySchema.players.eosId,
      reason: moderationSchema.bans.reason,
    })
    .from(moderationSchema.bans)
    .innerJoin(
      identitySchema.players,
      eq(identitySchema.players.id, moderationSchema.bans.playerId),
    )
    .where(
      and(
        aktifBanKosulu(new Date()),
        or(isNull(moderationSchema.bans.serverId), eq(moderationSchema.bans.serverId, serverId)),
      ),
    );
}

async function at(slug: string, ban: BanliOyuncu) {
  if (kip === 'dry') {
    logger.warn(
      { slug, playerId: ban.playerId, steamId: ban.steamId, reason: ban.reason },
      'KURU KOŞU: banlı oyuncu atılacaktı (BAN_ENFORCEMENT=dry)',
    );
    return;
  }
  const sonuc = await komutGonder(
    slug,
    'kick',
    { steamId: ban.steamId, eosId: ban.eosId, reason: ban.reason },
    'ban-enforcer',
  );
  if (sonuc.durum === 'ok') {
    logger.info({ slug, playerId: ban.playerId }, 'banlı oyuncu atıldı');
  } else {
    // Atamadıysak bir sonraki tarama tekrar dener — bu yüzden hata değil uyarı.
    logger.warn({ slug, playerId: ban.playerId, sonuc }, 'banlı oyuncu atılamadı');
  }
}

/**
 * Oyuncu girdiğinde çağrılır. Tek bir oyuncu için sorgu yapar, tüm ban
 * listesini çekmez: giriş olayı sık, ban tablosu 25 binden büyük.
 */
export async function girisAninda(
  db: Db,
  slug: string,
  serverId: string,
  steamId: string | null,
  eosId: string | null,
) {
  if (kip === 'off') return;
  if (!steamId && !eosId) return;
  const kimlikKosulu = steamId
    ? eq(identitySchema.players.steamId, steamId)
    : eq(identitySchema.players.eosId, (eosId as string).toLowerCase());

  const [banli] = await db
    .select({
      playerId: moderationSchema.bans.playerId,
      steamId: identitySchema.players.steamId,
      eosId: identitySchema.players.eosId,
      reason: moderationSchema.bans.reason,
    })
    .from(moderationSchema.bans)
    .innerJoin(
      identitySchema.players,
      eq(identitySchema.players.id, moderationSchema.bans.playerId),
    )
    .where(
      and(
        kimlikKosulu,
        aktifBanKosulu(new Date()),
        or(isNull(moderationSchema.bans.serverId), eq(moderationSchema.bans.serverId, serverId)),
      ),
    )
    .limit(1);

  if (!banli) return;
  await at(slug, banli);
}

/**
 * Periyodik tarama. Sunucudaki oyuncu listesini agent'tan alıp aktif
 * banlarla karşılaştırır.
 *
 * Karşılaştırma kimlik üzerinden: oyuncu adı değişebilir, kimlik değişmez.
 */
export async function taramaYap(db: Db) {
  if (kip === 'off') return;
  const sunucular = await db
    .select({ id: presenceSchema.servers.id, slug: presenceSchema.servers.slug })
    .from(presenceSchema.servers);

  for (const sunucu of sunucular) {
    if (!agentBagliMi(sunucu.slug)) continue;

    const cevap = await komutGonder(sunucu.slug, 'listPlayers', {}, 'ban-enforcer');
    if (cevap.durum !== 'ok') {
      logger.warn({ slug: sunucu.slug, cevap }, 'oyuncu listesi alınamadı, tarama atlandı');
      continue;
    }

    const ayristirilmis = OnlinePlayers.safeParse(cevap.data);
    if (!ayristirilmis.success) {
      logger.error({ slug: sunucu.slug }, 'oyuncu listesi beklenen biçimde değil');
      continue;
    }
    const online = ayristirilmis.data.players;
    if (online.length === 0) continue;

    const banlilar = await aktifBanlar(db, sunucu.id);
    if (banlilar.length === 0) continue;

    for (const ban of banliOlanlar(online, banlilar)) await at(sunucu.slug, ban);
  }
}

/** Taramayı başlatır; dönen fonksiyon durdurur. */
export function taramayiBaslat(db: Db): () => void {
  const zamanlayici = setInterval(() => {
    void taramaYap(db).catch((err) => logger.error({ err }, 'ban taraması başarısız'));
  }, TARAMA_ARALIGI_MS);
  // Node kapanışını bu zamanlayıcı engellemesin.
  zamanlayici.unref?.();
  logger.info({ aralikMs: TARAMA_ARALIGI_MS, kip }, 'ban taraması başladı');
  return () => clearInterval(zamanlayici);
}
