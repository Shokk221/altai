import type { AgentEvent } from '@altai/contracts';
import type { z } from 'zod';
import type { SquadJSOnlinePlayer, SquadJSServerStatusRaw } from './engine.js';

/**
 * Plugin sözleşmesi — plan Bölüm 6 ("Plugin sistemi — konsept kalır,
 * sözleşme yenilenir").
 *
 * Eski sistemin plugin'leri iki şeyi birden yapıyordu: oyun mantığını
 * yürütmek VE sonucu Discord'a basmak. 57 plugin'in ~20'si doğrudan Discord'a
 * mesaj atıyordu; bu yüzden bir killfeed formatını değiştirmek için plugin
 * koduna dokunmak gerekiyordu ve Discord kesintisi oyun mantığını da
 * etkiliyordu.
 *
 * YENİ KURAL: plugin Discord'u BİLMEZ. Plugin `ctx.emit()` ile olay üretir,
 * olay uplink üzerinden api'ye çıkar, bot dinler ve render eder. Bu yüzden
 * bu dosyada `discord` kelimesi geçmiyor ve geçmemeli.
 */

/** Plugin'in RCON'a erişimi — ham komut yerine niyet ifade eden yüzey. */
export interface PluginRcon {
  warn(playerId: string, message: string): Promise<void>;
  kick(playerId: string, reason: string): Promise<void>;
  broadcast(message: string): Promise<void>;
  /**
   * Oyuncuyu mangasından çıkarır — sunucudan ATMAZ.
   *
   * SL kit denetimi ve SL ban denetiminin uyguladığı yaptırım bu. Kick'ten
   * ayrı bir yüzey olması şart: ikisi çok farklı ağırlıkta cezalar ve
   * karıştırılması "kit almadı diye sunucudan atıldı" demek olurdu.
   */
  removeFromSquad(playerId: string): Promise<void>;
  /** Mangayı dağıtır. `teamId` olmadan çağrılamaz (bkz. SQUAD_CREATED.teamId). */
  disbandSquad(teamId: number, squadId: number): Promise<void>;
  /**
   * Sis savaşını açar/kapatır (1 = açık, 0 = kapalı).
   *
   * Harita genelinde etkili ve maçın gidişatını değiştiriyor; bu yüzden
   * çağıran plugin'lerin yetkiyi grup düzeyinde kontrol etmesi bekleniyor.
   */
  setFogOfWar(mode: 0 | 1): Promise<void>;
  /**
   * Oyuncunun takımını değiştirir.
   *
   * Squad'ın kendi komutu hedef takım ALMIYOR — oyuncuyu karşı tarafa
   * geçiriyor, o kadar. Bu yüzden "1. takıma al" diye bir çağrı yok;
   * çağıran taraf oyuncunun mevcut takımına bakıp karar vermek zorunda.
   */
  switchTeam(playerId: string): Promise<void>;
  /**
   * Kaçış kapısı. Yüzeyde karşılığı olmayan komutlar için; kullanımı
   * bilinçli olarak rahatsız edici, çünkü her kullanım bu arayüzün
   * eksik olduğunun işareti.
   */
  execute(command: string): Promise<string>;
}

/**
 * Plugin'e verilen bağlam.
 *
 * Veritabanı YOK: agent Postgres'e dokunmuyor (plan Bölüm 3). Kalıcı veri
 * gerektiren her şey `emit` ile api'ye gider, yazan orasıdır.
 */
export interface PluginContext {
  readonly serverSlug: string;

  rcon: PluginRcon;

  /** O an sunucudaki oyuncular (SquadJS önbelleğinden). */
  players(): Promise<SquadJSOnlinePlayer[]>;
  /** Sunucunun anlık durumu — oyuncu sayısı, kuyruk, geçerli layer. */
  status(): Promise<SquadJSServerStatusRaw>;
  /** Önbelleği RCON'dan tazeler — komut sonrası okumada şart. */
  refreshPlayers(): Promise<void>;

  /**
   * Oyuncunun GERÇEK admin yetkisi var mı?
   *
   * Yalnızca `reserve` yetkisi olan biri whitelist üyesidir, admin DEĞİL —
   * eski plugin'lerin hepsi bu ayrımı yapıyordu ve karıştırmak "bağışçı
   * olduğu için kicklenmedi" gibi sonuçlar üretirdi.
   *
   * Liste api'den geliyor (Admins.cfg'yi üreten sorgunun aynısı). Henüz
   * gelmediyse `false` döner: bilmediğimiz bir yetkiyi varmış gibi
   * saymaktansa muafiyet uygulamamak daha güvenli.
   */
  gercekAdminMi(steamId?: string | null, eosId?: string | null): boolean;

  /** Ham yetki dizesi ("changemap,cameraman"). Bilinmiyorsa null. */
  adminYetkileri(steamId?: string | null, eosId?: string | null): string | null;

  /**
   * Oyuncunun Admins.cfg grup adı ("SuperAdmin", "KlanWL"...). Yoksa null.
   *
   * Yetkiden ayrı bir soru: `kick` yetkisi olan herkes kıdemli admin
   * değildir. Ağır komutlar (sis savaşı gibi) buna bakıyor.
   */
  adminGrubu(steamId?: string | null, eosId?: string | null): string | null;

  /**
   * Oyuncunun AKTİF etiketleri (kaldırılmamış olanlar).
   *
   * Veri api'de; agent Postgres'e dokunmuyor. Bağlantı kopuksa ya da sorgu
   * zaman aşımına uğrarsa `null` döner — "etiketi yok" ile "bilmiyoruz"
   * farklı şeyler ve plugin ikisine farklı davranmalı. Eski SL ban
   * denetimi bunu karıştırıp BM'ye ulaşılamadığında herkesi temiz sayıyordu.
   */
  oyuncuEtiketleri(
    steamId?: string | null,
    eosId?: string | null,
  ): Promise<{ bulundu: boolean; flags: string[] } | null>;

  /**
   * Oyuncunun maç istatistikleri toplamı (Faz 4).
   *
   * `days` verilirse yalnızca o kadar gün geriye bakılır; verilmezse tüm
   * zamanlar. Bilinmiyorsa `null` — "istatistiği yok" ile "ulaşamadık"
   * farklı şeyler ve oyuncuya "hiç maçın yok" demek, veri varken yanlış
   * cevap olurdu.
   */
  oyuncuIstatistigi(
    steamId?: string | null,
    eosId?: string | null,
    days?: number | null,
  ): Promise<{
    bulundu: boolean;
    rounds: number;
    kills: number;
    deaths: number;
    revives: number;
    teamkills: number;
    bestKillstreak: number;
    damageDealt: number;
    damageTaken: number;
    wins: number;
    losses: number;
    kdr: number;
    winRate: number | null;
    topWeapons: Array<{ weapon: string; kills: number }>;
  } | null>;

  /**
   * Sıralama — ilk N oyuncu (Faz 4).
   *
   * `minRounds` K/D sıralamasında zorunlu: tek maçta 3 öldürüp hiç ölmeyen
   * biri, yüz maç oynamış herkesin üstüne çıkardı.
   *
   * Bilinmiyorsa `null`.
   */
  siralama(opts: {
    metric: 'kills' | 'kdr' | 'revives' | 'rounds';
    limit: number;
    days?: number | null;
    minRounds?: number;
  }): Promise<Array<{
    playerId: string;
    steamId: string | null;
    name: string | null;
    rounds: number;
    kills: number;
    deaths: number;
    revives: number;
    kdr: number;
  }> | null>;

  /** Oyuncunun toplam oynama süresi. Bilinmiyorsa null. */
  oyuncuSuresi(
    steamId?: string | null,
    eosId?: string | null,
  ): Promise<{ bulundu: boolean; toplamSaniye: number; oturum: number } | null>;

  /**
   * Verilen kimliklerin klan üyelikleri — TEK sorguda.
   *
   * Yalnızca aktif üyelikler döner. Klanı olmayan oyuncular cevapta yer
   * almaz. Bilinmiyorsa `null` — "kimse klanlı değil" ile karıştırılmamalı.
   */
  oyuncuKlanlari(ids: string[]): Promise<Array<{
    steamId: string | null;
    eosId: string | null;
    clan: string;
    tag: string | null;
  }> | null>;

  /**
   * Sunucunun son maçları (yeniden eskiye).
   *
   * Galibiyet serisi bundan TÜRETİLİYOR; plugin kendi sayacını tutmuyor.
   * İkinci bir doğruluk kaynağı, agent yeniden başladığında ya da iki
   * sunucu aynı veriyi yazdığında ayrışacak bir sayaç demekti.
   *
   * Bilinmiyorsa `null`.
   */
  sonMaclar(limit: number): Promise<Array<{
    winnerTeam: number | null;
    winnerTickets: number | null;
    loserTickets: number | null;
  }> | null>;

  /**
   * Verilen kimlikler arasında etiketi olanlar — TEK sorguda.
   *
   * Oyuncu başına ayrı sormak dolu bir sunucuda yüzlerce tur demek ve
   * cevap gelene kadar çağıran plugin bekliyor. `flagNames` boş
   * bırakılırsa bütün etiketler döner.
   *
   * Bilinmiyorsa `null` — "kimsenin etiketi yok" ile karıştırılmamalı.
   */
  etiketliOyuncular(
    ids: string[],
    flagNames?: string[],
  ): Promise<Array<{ steamId: string | null; eosId: string | null; flags: string[] }> | null>;

  /**
   * api'de bu SteamID için TAZE bir seviye kaydı var mı?
   *
   * Amaç dış servise gereksiz istek atmamak: Steam seviyesi yavaş değişen
   * bir veri ve her girişte sormak kotayı boşa harcıyor. Kaydın ne zaman
   * okunduğunu api biliyor, karar da orada veriliyor.
   *
   * Bilinmiyorsa (bağlantı yok, zaman aşımı) `null` döner — çağıran taraf
   * bunu "taze değil" sayıp okumayı denemeli: bir dış sorgunun
   * başarısızlığı yüzünden veri hiç toplanmamalı.
   */
  steamSeviyeTazeMi(
    steamId: string,
    maxAgeDays: number,
    privateMaxAgeDays: number,
  ): Promise<{ bulundu: boolean; taze: boolean } | null>;

  /**
   * Plugin'ler arası kısa ömürlü işaret bırakır.
   *
   * Bazı kurallar birden fazla plugin'i ilgilendiriyor: takım dengeleyici
   * karıştırma yaptıktan sonra takım değiştirme bir süre kapanmalı, yoksa
   * karıştırılan oyuncular anında eski taraflarına dönüp yapılan işi
   * geçersiz kılıyor.
   *
   * Olayla çözülemiyor: plugin'in `emit` ettiği şey api'ye gidiyor, diğer
   * plugin'lere değil. Ortak durumu paylaşmak da olmaz — plugin'ler
   * birbirinin belleğine dokunmamalı. Bu yüzden yüzey bilinçli olarak dar:
   * yalnızca ADI ve SÜRESİ olan bir işaret, veri taşımıyor.
   */
  isaretKoy(ad: string, sureSaniye: number): void;

  /** İşaret hâlâ geçerli mi? */
  isaretVarMi(ad: string): boolean;

  /**
   * Periyodik iş kaydeder.
   *
   * Zamanlayıcıyı plugin DEĞİL host tutuyor: plugin kapatıldığında hepsi
   * otomatik temizleniyor. Plugin kendi `setInterval`'ını kurarsa hot-reload
   * her seferinde bir zamanlayıcı daha bırakır ve yayınlar zamanla ikişer
   * üçer gitmeye başlar — eski sistemde tam olarak bu yaşandı.
   */
  every(ms: number, fn: () => void | Promise<void>): void;

  /**
   * Tek seferlik gecikmeli iş kaydeder.
   *
   * `every` ile aynı sebeple host'a ait: plugin kapatıldığında bekleyen iş
   * de İPTAL oluyor. Kapalı bir plugin'in on saniye sonra konuşması,
   * panelden kapatan kişinin beklemediği bir davranış olurdu.
   *
   * `ms` 0 ise iş bir sonraki döngüde çalışır, senkron değil — çağıranın
   * olay işleyicisi bitmeden araya girmemeli.
   */
  sonra(ms: number, fn: () => void | Promise<void>): void;

  /** Olay üretir: uplink -> api -> bot/panel. */
  emit(event: AgentEvent): void;

  /**
   * Host'un .env'inden gelen sırlar.
   *
   * Plugin ayarında DEĞİL burada: ayarlar panelden okunuyor ve denetim
   * kaydına öncesi/sonrasıyla yazılıyor. Bir API anahtarının oraya düşmesi
   * onu sızdırmak olurdu.
   */
  readonly secrets: {
    steamApiKey?: string | undefined;
  };

  log: {
    info(obj: Record<string, unknown>, msg: string): void;
    warn(obj: Record<string, unknown>, msg: string): void;
    error(obj: Record<string, unknown>, msg: string): void;
  };
}

/**
 * Bir plugin.
 *
 * `configSchema` zorunlu: ayarlar panelden geliyor ve doğrulanmamış bir
 * ayarla canlı sunucuda çalışmak, sessizce yanlış davranmak demek. Şema
 * tutmazsa host plugin'i AÇMAZ ve sebebini loglar — agent çökmez.
 */
export interface Plugin<C = unknown> {
  readonly name: string;
  /** Panelde görünen tek satırlık açıklama. */
  readonly description: string;
  /**
   * Girdi tipi `unknown`: ayar JSONB'den geliyor ve `.default()` kullanan
   * şemalarda girdi ile çıktı tipi ayrışıyor (alan girdide isteğe bağlı,
   * çıktıda dolu). `z.ZodType<C>` ikisinin aynı olmasını dayatıyor ve
   * varsayılanı olan her plugin şemasını reddediyordu.
   */
  readonly configSchema: z.ZodType<C, z.ZodTypeDef, unknown>;

  /**
   * Plugin'i AÇAR ve çalışan bir örnek döndürür.
   *
   * Fabrika olması bilinçli. Önce `onEnable`/`onEvent` aynı nesnenin
   * metotlarıydı ve durumu (bekleyen zamanlayıcılar, takip listeleri)
   * nesnenin üstünde tutmak gerekiyordu. Plugin ise kayıt defterinde TEK
   * bir nesne: hot-reload'da o durum silinmiyor, yeni ayarla açılan
   * plugin eski durumuyla devam ediyordu.
   *
   * Fabrikada her açılış kendi kapanışını (closure) alıyor; kapatılan
   * örneğe hiçbir referans kalmadığı için durum da onunla gidiyor.
   */
  create(ctx: PluginContext, config: C): PluginInstance | Promise<PluginInstance>;
}

/** Açık bir plugin örneği. */
export interface PluginInstance {
  /**
   * Tipli oyun olayları. Ham SquadJS değil, adapter'dan geçmiş `AgentEvent`:
   * SquadJS sürümü değişince plugin'ler değil yalnızca adapter etkilenir.
   */
  onEvent?(event: AgentEvent): void | Promise<void>;
  /** Zamanlayıcıları host temizliyor; burası yalnızca plugin'e özel temizlik. */
  onDisable?(): void | Promise<void>;
}

/** Host'un kayıt defterindeki gevşek tip — farklı config tipleri bir arada. */
export type AnyPlugin = Plugin<never>;

/** api'den gelen ayar satırı (plugin_configs tablosunun taşınan hâli). */
export interface PluginConfigRow {
  pluginName: string;
  enabled: boolean;
  config: Record<string, unknown>;
}
