import { z } from 'zod';
import { AgentCommand, AgentCommandResult } from './agent-commands.js';
import { AgentEvent } from './agent-events.js';

// Agent, api'ye dışa doğru kalıcı bir WS açar (Bölüm 3 — oyun sunucusunda
// içe açık port gerekmez). Bağlantı kurulduğunda ilk mesaj her zaman "hello"
// olmalı; api bunu AGENT_SHARED_SECRET ile doğrular.
export const AgentHello = z.object({
  type: z.literal('hello'),
  serverSlug: z.string(),
  secret: z.string(),
});
export type AgentHello = z.infer<typeof AgentHello>;

// Agent düzgün kapanırken (SIGTERM) gönderir. api bunu alınca o sunucunun
// açık session'larını gerçek zaman damgasıyla kapatır.
//
// WS'in kopması TEK BAŞINA session kapatma sebebi değildir — geçici bir ağ
// kesintisi de aynı görünür ve oyuncular hâlâ oyunda olabilir. Bu yüzden
// kapanış açıkça bildirilir; bildirim hiç gelmezse (crash, konteyner kill)
// açık session'ları bir sonraki hello'daki reconciler 4 saat üst sınırıyla
// toparlar.
export const AgentShutdown = z.object({
  type: z.literal('shutdown'),
  timestamp: z.string().datetime(),
});
export type AgentShutdown = z.infer<typeof AgentShutdown>;

/**
 * Agent -> api SORGUSU.
 *
 * Protokol şimdiye kadar tek yönlüydü: olay yukarı, komut aşağı. Oysa
 * plugin'lerin bir kısmı VERİ OKUMAK istiyor — "bu oyuncunun etiketi var
 * mı", "kaç saat oynamış", "notu var mı". Agent'ın Postgres'e dokunmaması
 * doğru bir karar (plan Bölüm 3); eksik olan, aynı WS üzerinden soru
 * sorabilmekti.
 *
 * `komutGonder`'in (api -> agent) simetriği: correlationId ile eşleşen
 * istek/yanıt, zaman aşımlı. Yanıt gelmezse plugin bekleyip kalmıyor.
 *
 * Sorgu türleri BİLEREK dar tutuluyor. Genel bir "SQL çalıştır" ucu,
 * agent'a veritabanı erişimi vermemenin bütün anlamını ortadan kaldırırdı.
 */
export const AgentQuery = z.discriminatedUnion('kind', [
  /** Oyuncunun AKTİF etiketleri (kaldırılmamış olanlar). */
  z.object({
    kind: z.literal('player_flags'),
    steamId: z.string().nullish(),
    eosId: z.string().nullish(),
  }),
  /** Oyuncunun toplam oynama süresi ve oturum sayısı. */
  z.object({
    kind: z.literal('player_clans'),
    /** Aranacak kimlikler (steam ya da eos). */
    ids: z.array(z.string().min(1)).min(1).max(150),
  }),
  z.object({
    kind: z.literal('recent_rounds'),
    /** Kaç maç geriye bakılacak. */
    limit: z.number().int().min(1).max(20),
  }),
  z.object({
    kind: z.literal('flagged_players'),
    /**
     * Aranacak kimlikler (steam ya da eos, karışık olabilir).
     *
     * Toplu sorgu ŞART: admin kameraya geçtiğinde sunucudaki 100 oyuncu
     * için ayrı ayrı sormak 100 tur demek ve cevap gelene kadar admin
     * ekranda bekliyor. Sınır bilinçli — istek boyutu sunucu doluluğuyla
     * sınırlı kalmalı.
     */
    ids: z.array(z.string().min(1)).min(1).max(150),
    /** Yalnızca bu adlardaki etiketler döner (harf duyarsız). Boş = hepsi. */
    flagNames: z.array(z.string().min(1)).max(20).default([]),
  }),
  z.object({
    kind: z.literal('steam_level_freshness'),
    steamId: z.string(),
    /**
     * Kayıt kaç günden eskiyse bayat sayılır. Eşiği SORAN taraf veriyor:
     * okuma sıklığı plugin'in ayarı ve api'nin onu ayrıca bilmesi, aynı
     * sayıyı iki yerde tutmak olurdu.
     */
    maxAgeDays: z.number().int().positive(),
    /** Gizli profiller için ayrı (daha kısa) tazelik süresi. */
    privateMaxAgeDays: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('player_playtime'),
    steamId: z.string().nullish(),
    eosId: z.string().nullish(),
  }),
  /** Oyuncunun maç istatistikleri toplamı (Faz 4). */
  z.object({
    kind: z.literal('player_stats'),
    steamId: z.string().nullish(),
    eosId: z.string().nullish(),
    /**
     * Kaç gün geriye bakılacak. Verilmezse tüm zamanlar.
     *
     * Eşiği SORAN taraf veriyor: "bu ayki istatistiğim" ile "tüm zamanlar"
     * aynı sorgunun iki kullanımı ve hangisinin isteneceği plugin'in ayarı.
     */
    days: z.number().int().positive().max(3650).nullish(),
  }),
  /** Sıralama — ilk N oyuncu (Faz 4). */
  z.object({
    kind: z.literal('leaderboard'),
    metric: z.enum(['kills', 'kdr', 'revives', 'rounds']),
    limit: z.number().int().min(1).max(25),
    days: z.number().int().positive().max(3650).nullish(),
    /**
     * Sıralamaya girmek için gereken en az maç sayısı.
     *
     * K/D sıralamasında ŞART: tek maçta 3 öldürüp hiç ölmeyen biri, yüz
     * maç oynamış herkesin üstüne çıkardı. Eşiği çağıran veriyor çünkü
     * doğru değer sunucunun doluluğuna göre değişiyor.
     */
    minRounds: z.number().int().min(0).max(1000).default(0),
  }),
]);
export type AgentQuery = z.infer<typeof AgentQuery>;

export const AgentQueryRequest = z.object({
  correlationId: z.string().uuid(),
  query: AgentQuery,
});
export type AgentQueryRequest = z.infer<typeof AgentQueryRequest>;

export const AgentQueryResult = z.object({
  correlationId: z.string().uuid(),
  ok: z.boolean(),
  /** Sorgu türüne göre değişen yük; şekli sorguyu açan taraf bilir. */
  data: z.unknown().optional(),
  error: z.string().optional(),
});
export type AgentQueryResult = z.infer<typeof AgentQueryResult>;

// agent -> api yönünde giden zarf
export const AgentToApiMessage = z.union([
  AgentHello,
  AgentShutdown,
  z.object({ type: z.literal('event'), event: AgentEvent }),
  z.object({ type: z.literal('command_result'), result: AgentCommandResult }),
  z.object({ type: z.literal('query'), request: AgentQueryRequest }),
]);
export type AgentToApiMessage = z.infer<typeof AgentToApiMessage>;

/**
 * Plugin ayarları — plan Bölüm 6 ("Config Postgres'te, panelden düzenlenir,
 * WS ile hot-reload").
 *
 * Agent'ın Postgres'e erişimi YOK (Bölüm 3), o yüzden ayarlar bu kanaldan
 * geliyor: bağlanınca hello_ack'in ardından bir kez, sonra panelden her
 * değişiklikte yeniden.
 *
 * Gönderilen liste TAM: agent bunu olduğu gibi uyguluyor ve listede olmayan
 * plugin'i kapatıyor. Artımlı gönderim, kaçan tek bir mesajın agent'ı
 * panelden farklı bir durumda bırakmasına yol açardı ve fark hiçbir yerde
 * görünmezdi.
 */
export const PluginConfigRow = z.object({
  pluginName: z.string().min(1),
  enabled: z.boolean(),
  config: z.record(z.unknown()),
});
export type PluginConfigRow = z.infer<typeof PluginConfigRow>;

/**
 * Oyun içi yetki listesi — plugin'lerin "admini muaf tut" kontrolü için.
 *
 * Vendored SquadJS'in `loadAdminsFromDB`'si Mongo bağımlılığı kaldırılırken
 * boş liste dönen bir stub'a çevrilmişti. Sonuç: `server.admins` her zaman
 * boş, yani eski plugin'lerin admin muafiyeti HER ZAMAN "admin değil"
 * diyordu. Adminler kendi yetkilerinin görünmediği plugin'ler tarafından
 * cezalandırılırdı.
 *
 * Liste, Admins.cfg'yi üreten sorgunun ta kendisinden geliyor (api'de
 * `adminKayitlari`) — oyun içi yetki ile plugin muafiyeti aynı kaynaktan
 * beslendiği için ayrışamazlar.
 *
 * `permissions` Squad'ın kendi yazımı: virgülle ayrılmış erişim seviyeleri
 * ("changemap,cameraman,kick"). Ham hâlde taşınıyor çünkü "gerçek admin mi"
 * kararı plugin'e göre değişiyor — yalnızca `reserve` yetkisi olan biri
 * whitelist üyesidir, admin değil.
 */
export const AdminIdentity = z.object({
  steamId: z.string().nullish(),
  eosId: z.string().nullish(),
  groupName: z.string(),
  permissions: z.string(),
});
export type AdminIdentity = z.infer<typeof AdminIdentity>;

// api -> agent yönünde giden zarf
export const ApiToAgentMessage = z.union([
  z.object({ type: z.literal('hello_ack'), serverId: z.string() }),
  z.object({ type: z.literal('hello_reject'), reason: z.string() }),
  z.object({ type: z.literal('command'), command: AgentCommand }),
  z.object({ type: z.literal('plugin_configs'), configs: z.array(PluginConfigRow) }),
  z.object({ type: z.literal('admin_list'), admins: z.array(AdminIdentity) }),
  z.object({ type: z.literal('query_result'), result: AgentQueryResult }),
]);
export type ApiToAgentMessage = z.infer<typeof ApiToAgentMessage>;
