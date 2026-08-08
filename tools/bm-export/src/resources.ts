/**
 * Arşivlenecek BM kaynaklarının bildirimsel tanımı.
 *
 * Endpoint'ler ve filtre/include adları BM'nin resmî API yüzeyinden
 * doğrulandı (api.battlemetrics.com, JSON:API). Bir uç token'ınızın
 * planında kapalıysa (403) ya da hiç yoksa (404) arşivleme durmaz —
 * o kaynak `unsupported` işaretlenip diğerlerine geçilir; `--probe` ile
 * tam çekimden önce hangilerinin açık olduğunu görebilirsiniz.
 */

export interface ExportContext {
  organizationId: string;
  /** Org'a ait sunucu ID'leri — filter[servers] için (Faz 0'da keşfedilir). */
  serverIds: string[];
}

export interface ListResource {
  name: string;
  path: string;
  /** Bu kaynak neden arşivleniyor — rapora ve --probe çıktısına yazılır. */
  purpose: string;
  /** true ise kayıp olması geçişi durdurmalı (plan Bölüm 5.5-A kritik listesi). */
  critical: boolean;
  params(ctx: ExportContext): Record<string, string>;
}

const PAGE_SIZE = '100';

export const LIST_RESOURCES: ListResource[] = [
  {
    name: 'players',
    path: '/players',
    purpose:
      "Oyuncular + identifier'lar (SteamID/EOS eşlemesi, isim geçmişi) ve sunucu bazlı firstSeen/lastSeen/timePlayed",
    critical: true,
    params: (ctx) => ({
      'page[size]': PAGE_SIZE,
      // KRİTİK: filtresiz /players BM'nin TÜM global oyuncu veritabanını
      // sayfalamaya çalışır (milyonlarca kayıt). Kendi sunucularımıza kısıtlıyoruz.
      'filter[servers]': ctx.serverIds.join(','),
      include: 'identifier,server',
    }),
  },
  {
    name: 'sessions',
    path: '/sessions',
    purpose: 'Tarihsel session geçmişi (giriş/çıkış/süre) — presence verisinin kaynağı',
    critical: true,
    params: (ctx) => ({
      'page[size]': PAGE_SIZE,
      'filter[servers]': ctx.serverIds.join(','),
      include: 'identifier,server',
    }),
  },
  {
    name: 'bans',
    path: '/bans',
    purpose: 'Banlar — sebep, süre, kanıt, banı atan admin, ban listesi',
    critical: true,
    params: (ctx) => ({
      'page[size]': PAGE_SIZE,
      'filter[organization]': ctx.organizationId,
      // Süresi dolmuş banlar varsayılan olarak gelmez — arşivde hepsi olmalı.
      'filter[expired]': 'true',
      include: 'organization,player,server,user',
    }),
  },
  {
    name: 'ban-lists',
    path: '/ban-lists',
    purpose: 'Ban listesi tanımları (paylaşımlı listeler dahil)',
    critical: true,
    params: () => ({ 'page[size]': PAGE_SIZE, include: 'organization,owner' }),
  },
  {
    name: 'bans-native',
    path: '/bans-native',
    purpose: 'Oyunun kendi ban dosyasına yansıtılmış banlar (senkron durumu)',
    critical: false,
    // Bu uç filter[organization] KABUL ETMİYOR ("must NOT have additional
    // properties" ile 400 döner) — token zaten org kapsamında çalışıyor.
    params: () => ({ 'page[size]': PAGE_SIZE }),
  },
  {
    name: 'player-flags',
    path: '/player-flags',
    purpose:
      'Flag TANIMLARI (isim, renk, ikon) — "HİLE ŞÜPHELİSİ", "SL BAN" vb. SL-ban sistemi buna bağlı',
    critical: true,
    params: () => ({ 'page[size]': PAGE_SIZE, 'filter[personal]': 'false' }),
  },
  {
    name: 'reserved-slots',
    path: '/reserved-slots',
    purpose: 'Reserved slot / whitelist kayıtları',
    critical: true,
    params: (ctx) => ({
      'page[size]': PAGE_SIZE,
      'filter[organization]': ctx.organizationId,
      'filter[expired]': 'true',
      include: 'player,server,user',
    }),
  },
  {
    name: 'player-queries',
    path: '/player-queries',
    purpose: 'Kayıtlı oyuncu sorguları (BM panelindeki hazır filtreler)',
    critical: false,
    params: (ctx) => ({ 'page[size]': PAGE_SIZE, 'filter[organizations]': ctx.organizationId }),
  },
];

/**
 * Oyuncu başına çekilen kaynaklar. BM'de bunların org geneli listeleme ucu
 * YOK — her oyuncu için ayrı istek gerekir, bu yüzden ayrı bir faz olarak
 * ve devam edilebilir şekilde çalıştırılır.
 *
 * Burada SADECE notlar var. Flag atamaları da başta buradaydı, ama
 * /players?filter[playerFlags]= ile flag başına taranabildiği ortaya çıktı —
 * bkz. flag-assignments.ts. Notlar için böyle bir filtre yok (denendi).
 */
export interface PerPlayerResource {
  name: string;
  purpose: string;
  critical: boolean;
  path(playerId: string): string;
  params: Record<string, string>;
}

export const PER_PLAYER_RESOURCES: PerPlayerResource[] = [
  {
    name: 'player-notes',
    purpose: 'Oyuncu notları (yazar + zaman dahil) — moderasyon geçmişinin yarısı',
    critical: true,
    path: (playerId) => `/players/${playerId}/relationships/notes`,
    params: { 'page[size]': PAGE_SIZE, include: 'user,organization' },
  },
];

/**
 * Flag atamaları PER_PLAYER_RESOURCES'ta değil ama kritik bir kaynak —
 * rapor ve --probe bunu bilmeli.
 */
export const FLAG_ASSIGNMENT_RESOURCE = {
  name: 'player-flag-assignments',
  purpose: 'Flag ATAMALARI (hangi oyuncuda hangi flag var) — SL banları burada',
  critical: true,
} as const;

/**
 * Sunucu başına, zaman aralığı isteyen geçmiş uçları. start/stop zorunlu,
 * bu yüzden ay ay parçalanarak çekilir.
 */
export interface ServerHistoryResource {
  name: string;
  purpose: string;
  critical: boolean;
  path(serverId: string): string;
  /** Ek sabit parametreler (örn. player-count-history için resolution). */
  extraParams?: Record<string, string>;
}

export const SERVER_HISTORY_RESOURCES: ServerHistoryResource[] = [
  {
    name: 'player-count-history',
    purpose: 'Popülasyon geçmişi (saatlik çözünürlük) — server_snapshots tarihçesi',
    critical: false,
    path: (serverId) => `/servers/${serverId}/player-count-history`,
    // raw çözünürlük yıllara yayılınca devasa olur; 60 dk yeterli (grafik verisi).
    extraParams: { resolution: '60' },
  },
  {
    name: 'unique-player-history',
    purpose: 'Günlük benzersiz oyuncu sayısı',
    critical: false,
    path: (serverId) => `/servers/${serverId}/unique-player-history`,
  },
  {
    name: 'first-time-history',
    purpose: 'İlk kez gelen oyuncu sayısı geçmişi',
    critical: false,
    path: (serverId) => `/servers/${serverId}/first-time-history`,
  },
  {
    name: 'time-played-history',
    purpose: 'Toplam oynanma süresi geçmişi',
    critical: false,
    path: (serverId) => `/servers/${serverId}/time-played-history`,
  },
];

/** Sunucu başına, sayfalanan (zaman aralığı istemeyen) kaynaklar. */
export interface ServerListResource {
  name: string;
  purpose: string;
  critical: boolean;
  path(serverId: string): string;
  params: Record<string, string>;
}

export const SERVER_LIST_RESOURCES: ServerListResource[] = [
  {
    name: 'outages',
    purpose: 'Sunucu kesinti geçmişi',
    critical: false,
    path: (serverId) => `/servers/${serverId}/relationships/outages`,
    params: { 'page[size]': PAGE_SIZE },
  },
  {
    name: 'leaderboard-time',
    purpose: "Oynama süresi leaderboard'u (tüm zamanlar)",
    critical: false,
    path: (serverId) => `/servers/${serverId}/relationships/leaderboards/time`,
    params: { 'page[size]': PAGE_SIZE, 'filter[period]': 'AT' },
  },
];

/**
 * Bilinçli olarak arşivlenmeyen: /players/{id}/relationships/coplay.
 * Plan Bölüm 5.5-A kararı — API'de var ama oyuncu başına ayrı istek gerektiriyor
 * ve aynı bilgi kesişen session aralıklarından SQL ile türetilebiliyor (Bölüm 5).
 */
