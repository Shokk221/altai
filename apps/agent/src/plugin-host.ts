import type { AgentEvent, AgentQuery } from '@altai/contracts';
import { logger } from '@altai/shared';
import type {
  AnyPlugin,
  Plugin,
  PluginConfigRow,
  PluginContext,
  PluginInstance,
  PluginRcon,
  SquadJSEngine,
} from '@altai/squad';
import { AdminRegistry } from './admin-registry.js';

/**
 * PluginHost — plugin'leri açar, kapatır ve ayar değişince yeniden kurar.
 *
 * Tasarımın üç sabit fikri var:
 *
 *  1. HOT-RELOAD = KAPAT + AÇ. Ayar değişince plugin'e "şu alan değişti"
 *     demiyoruz; kapatıp yeni ayarla açıyoruz. Kısmi güncelleme, plugin
 *     yazarını her alan için ayrı bir geçiş yolu düşünmeye zorlar ve o
 *     yolların çoğu hiç test edilmez.
 *
 *  2. BİR PLUGIN AGENT'I DÜŞÜREMEZ. Yükleme, olay işleme ve zamanlayıcıların
 *     tamamı yakalanıyor. Canlı sunucuda bir plugin'in hatası yüzünden log
 *     toplamanın durması, o plugin'in verdiği faydadan çok daha pahalı.
 *
 *  3. ZAMANLAYICILARI HOST TUTAR. Plugin kapatıldığında hepsi temizleniyor.
 *     Plugin kendi setInterval'ını kurarsa hot-reload her seferinde bir
 *     zamanlayıcı daha bırakır; yayınlar önce ikişer, sonra üçer gitmeye
 *     başlar ve sebebi aylarca bulunamaz.
 */

interface AcikPlugin {
  plugin: AnyPlugin;
  /** Bu açılışa ait örnek — durumunu kendi kapanışında tutuyor. */
  ornek: PluginInstance;
  zamanlayicilar: ReturnType<typeof setInterval>[];
  /** Açılışta kullanılan ayarın imzası — gereksiz yeniden kurulumu önler. */
  imza: string;
}

export interface PluginHostOptions {
  serverSlug: string;
  engine: SquadJSEngine;
  /** Plugin'lerin ürettiği olayları uplink'e taşır. */
  emit(event: AgentEvent): void;
  /** .env'den gelen sırlar — plugin ayarında taşınmamalı olanlar. */
  secrets?: { steamApiKey?: string | undefined };
  /**
   * api'ye veri sorar. Verilmezse plugin'ler her sorguda null alır —
   * testlerde ve bağlantısız çalışmada beklenen davranış.
   */
  sorgu?: (query: AgentQuery) => Promise<unknown | null>;
}

export class PluginHost {
  private readonly kayitli = new Map<string, AnyPlugin>();
  private readonly acik = new Map<string, AcikPlugin>();
  private readonly opts: PluginHostOptions;
  /**
   * Oyun içi yetki listesi. Plugin'ler bunu `ctx.gercekAdminMi` ile
   * sorguluyor; api'den gelene kadar boş ve o hâlde kimse admin sayılmıyor.
   */
  private readonly adminler = new AdminRegistry();
  /**
   * Plugin'ler arası işaretler: ad -> bitiş zamanı (ms).
   *
   * Host'ta duruyor çünkü plugin'ler hot-reload'da kapanıp açılıyor ve
   * işaretin ömrü plugin örneğinden uzun olabiliyor: karıştırma sonrası
   * kilit, dengeleyici yeniden kurulsa bile sürmeli.
   */
  private readonly isaretler = new Map<string, number>();

  constructor(opts: PluginHostOptions) {
    this.opts = opts;
  }

  /** Kod tarafındaki plugin listesi — panel bu adları gösteriyor. */
  register(...plugins: AnyPlugin[]): void {
    for (const p of plugins) {
      if (this.kayitli.has(p.name)) {
        throw new Error(`plugin adı iki kez kayıtlı: ${p.name}`);
      }
      this.kayitli.set(p.name, p);
    }
  }

  /** Panelde listelenecek plugin'ler. */
  katalog(): Array<{ name: string; description: string }> {
    return [...this.kayitli.values()].map((p) => ({
      name: p.name,
      description: p.description,
    }));
  }

  acikPluginler(): string[] {
    return [...this.acik.keys()];
  }

  /**
   * api'den gelen ayar kümesini uygular.
   *
   * Gelen küme TAM liste kabul ediliyor: listede olmayan bir plugin
   * kapatılır. Böylece panelden silinen bir ayar agent'ta asılı kalmıyor.
   */
  async applyConfigs(rows: PluginConfigRow[]): Promise<void> {
    const istenen = new Map(rows.map((r) => [r.pluginName, r]));

    // 1) Artık istenmeyen ya da kapatılmış olanları kapat.
    for (const name of [...this.acik.keys()]) {
      const row = istenen.get(name);
      if (!row || !row.enabled) await this.kapat(name);
    }

    // 2) İstenenleri aç ya da ayarı değiştiyse yeniden kur.
    for (const row of rows) {
      if (!row.enabled) continue;

      const plugin = this.kayitli.get(row.pluginName);
      if (!plugin) {
        // Ayar var ama kodda böyle bir plugin yok: panelde eski bir satır
        // kalmış olabilir. Sessizce yutmak, "açtım ama çalışmıyor" diye
        // saatlerce aranmasına yol açar.
        logger.warn({ plugin: row.pluginName }, 'bilinmeyen plugin, ayar yok sayıldı');
        continue;
      }

      const imza = JSON.stringify(row.config);
      const mevcut = this.acik.get(row.pluginName);
      if (mevcut && mevcut.imza === imza) continue; // değişmemiş

      if (mevcut) await this.kapat(row.pluginName);
      await this.ac(plugin, row.config, imza);
    }
  }

  /** Tipli olayı açık plugin'lere dağıtır. */
  async handleEvent(event: AgentEvent): Promise<void> {
    for (const [name, kayit] of this.acik) {
      if (!kayit.ornek.onEvent) continue;
      try {
        await kayit.ornek.onEvent(event);
      } catch (err) {
        logger.error({ err, plugin: name, event: event.type }, 'plugin olay işlerken hata verdi');
      }
    }
  }

  /** api'den gelen oyun içi yetki listesini uygular. */
  adminListesiniGuncelle(admins: Parameters<AdminRegistry['guncelle']>[0]): void {
    this.adminler.guncelle(admins);
    logger.info({ adet: this.adminler.boyut() }, 'oyun içi yetki listesi güncellendi');
  }

  /** Agent kapanırken: hepsini düzgün kapat. */
  async stop(): Promise<void> {
    for (const name of [...this.acik.keys()]) await this.kapat(name);
  }

  // ------------------------------------------------------------- iç işler

  private async ac(
    plugin: AnyPlugin,
    hamConfig: Record<string, unknown>,
    imza: string,
  ): Promise<void> {
    // Ayar doğrulanmadan plugin AÇILMAZ. Yanlış ayarla çalışan bir plugin,
    // kapalı bir plugin'den daha tehlikeli: canlı sunucuda yanlış eşikle
    // oyuncu atmaya başlayabilir.
    const parsed = plugin.configSchema.safeParse(hamConfig);
    if (!parsed.success) {
      // HANGİ ALAN olduğu şart. Yalnızca mesajı loglamak ("Required")
      // panelde ayarı düzeltmeye çalışan kişiye hiçbir şey söylemiyor —
      // gerçekten denendi ve hangi alanın eksik olduğu anlaşılmadı.
      const sorunlar = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(kök)'}: ${i.message}`)
        .join('; ');
      logger.error(
        { plugin: plugin.name, sorunlar, gelen: Object.keys(hamConfig) },
        'plugin ayarı geçersiz — plugin açılmadı',
      );
      return;
    }

    const zamanlayicilar: ReturnType<typeof setInterval>[] = [];
    const ctx = this.contextOlustur(plugin.name, zamanlayicilar);

    try {
      const ornek = await plugin.create(ctx, parsed.data as never);
      this.acik.set(plugin.name, { plugin, ornek, zamanlayicilar, imza });
      logger.info({ plugin: plugin.name }, 'plugin açıldı');
    } catch (err) {
      // create yarıda kaldıysa kurmuş olabileceği zamanlayıcıları temizle:
      // yarım açılmış bir plugin'in zamanlayıcısı sahipsiz kalırdı.
      for (const z of zamanlayicilar) clearInterval(z);
      logger.error({ err, plugin: plugin.name }, 'plugin açılamadı');
    }
  }

  private async kapat(name: string): Promise<void> {
    const kayit = this.acik.get(name);
    if (!kayit) return;

    // Zamanlayıcılar ÖNCE durduruluyor: onDisable çalışırken tetiklenen bir
    // periyodik iş, kapanmakta olan plugin'in yarım durumuna dokunurdu.
    for (const z of kayit.zamanlayicilar) clearInterval(z);
    this.acik.delete(name);

    try {
      await kayit.ornek.onDisable?.();
    } catch (err) {
      logger.error({ err, plugin: name }, 'plugin kapanırken hata verdi');
    }
    logger.info({ plugin: name }, 'plugin kapandı');
  }

  private contextOlustur(
    pluginAdi: string,
    zamanlayicilar: ReturnType<typeof setInterval>[],
  ): PluginContext {
    const { engine, serverSlug, emit } = this.opts;

    const rcon: PluginRcon = {
      warn: async (playerId, message) => {
        await engine.rconExecute(`AdminWarn ${playerId} ${tekSatir(message)}`);
      },
      kick: async (playerId, reason) => {
        await engine.rconExecute(`AdminKick ${playerId} ${tekSatir(reason)}`);
      },
      broadcast: async (message) => {
        await engine.rconExecute(`AdminBroadcast ${tekSatir(message)}`);
      },
      removeFromSquad: async (playerId) => {
        // Tırnak ŞART: Squad'ın komut ayrıştırıcısı tırnaksız kimliği
        // bazı durumlarda isim sanıyor.
        await engine.rconExecute(`AdminRemovePlayerFromSquad "${tekSatir(playerId, 40)}"`);
      },
      disbandSquad: async (teamId, squadId) => {
        // Sayı olmayan değer komutu bozar; çağıran taraf zaten sayı
        // gönderiyor ama buradan geçen her şey RCON'a gidiyor.
        if (!Number.isInteger(teamId) || !Number.isInteger(squadId)) {
          throw new Error('disbandSquad: teamId ve squadId tam sayı olmalı');
        }
        await engine.rconExecute(`AdminDisbandSquad ${teamId} ${squadId}`);
      },
      setFogOfWar: async (mode) => {
        // Ayar/parametre doğrudan RCON'a gidiyor; yalnızca 0 ve 1 geçerli.
        if (mode !== 0 && mode !== 1) throw new Error('setFogOfWar: mode 0 ya da 1 olmalı');
        await engine.rconExecute(`AdminSetFogOfWar ${mode}`);
      },
      switchTeam: async (playerId) => {
        await engine.rconExecute(`AdminForceTeamChange ${tekSatir(playerId)}`);
      },
      execute: (command) => engine.rconExecute(command),
    };

    return {
      serverSlug,
      rcon,
      players: () => engine.getPlayers(),
      status: () => engine.getStatus(),
      gercekAdminMi: (steamId, eosId) => this.adminler.gercekAdminMi(steamId, eosId),
      adminYetkileri: (steamId, eosId) => this.adminler.adminYetkileri(steamId, eosId),
      adminGrubu: (steamId, eosId) => this.adminler.grup(steamId, eosId),
      // `?? null` şart: sorgu kanalı bağlı değilse `sorgu?.()` undefined
      // döner ve plugin'ler `=== null` ile "bilmiyoruz" durumunu kontrol
      // ediyor. undefined oradan sessizce sızsa "etiketi yok" gibi okunurdu.
      oyuncuEtiketleri: async (steamId, eosId) =>
        ((await this.opts.sorgu?.({
          kind: 'player_flags',
          ...(steamId ? { steamId } : {}),
          ...(eosId ? { eosId } : {}),
        })) as { bulundu: boolean; flags: string[] } | null | undefined) ?? null,
      oyuncuSuresi: async (steamId, eosId) =>
        ((await this.opts.sorgu?.({
          kind: 'player_playtime',
          ...(steamId ? { steamId } : {}),
          ...(eosId ? { eosId } : {}),
        })) as { bulundu: boolean; toplamSaniye: number; oturum: number } | null | undefined) ??
        null,
      klanSavasiKadrosu: async () =>
        ((await this.opts.sorgu?.({ kind: 'clan_war_roster' })) as
          | Awaited<ReturnType<PluginContext['klanSavasiKadrosu']>>
          | undefined) ?? null,
      sunucuKurallari: async () =>
        ((await this.opts.sorgu?.({ kind: 'server_rules' })) as
          | Awaited<ReturnType<PluginContext['sunucuKurallari']>>
          | undefined) ?? null,
      sesDurumu: async (steamId, eosId, maxAgeSeconds) =>
        ((await this.opts.sorgu?.({
          kind: 'discord_voice',
          ...(steamId ? { steamId } : {}),
          ...(eosId ? { eosId } : {}),
          maxAgeSeconds: maxAgeSeconds ?? 90,
        })) as Awaited<ReturnType<PluginContext['sesDurumu']>> | undefined) ?? null,
      oyuncuIstatistigi: async (steamId, eosId, days) =>
        ((await this.opts.sorgu?.({
          kind: 'player_stats',
          ...(steamId ? { steamId } : {}),
          ...(eosId ? { eosId } : {}),
          ...(days ? { days } : {}),
        })) as Awaited<ReturnType<PluginContext['oyuncuIstatistigi']>> | undefined) ?? null,
      siralama: async (opts) =>
        ((await this.opts.sorgu?.({
          kind: 'leaderboard',
          metric: opts.metric,
          limit: opts.limit,
          ...(opts.days ? { days: opts.days } : {}),
          minRounds: opts.minRounds ?? 0,
        })) as Awaited<ReturnType<PluginContext['siralama']>> | undefined) ?? null,
      oyuncuKlanlari: async (ids) => {
        if (ids.length === 0) return [];
        return (
          ((await this.opts.sorgu?.({ kind: 'player_clans', ids })) as
            | Array<{
                steamId: string | null;
                eosId: string | null;
                clan: string;
                tag: string | null;
              }>
            | null
            | undefined) ?? null
        );
      },
      sonMaclar: async (limit) =>
        ((await this.opts.sorgu?.({ kind: 'recent_rounds', limit })) as
          | Array<{
              winnerTeam: number | null;
              winnerTickets: number | null;
              loserTickets: number | null;
            }>
          | null
          | undefined) ?? null,
      etiketliOyuncular: async (ids, flagNames) => {
        if (ids.length === 0) return [];
        return (
          ((await this.opts.sorgu?.({
            kind: 'flagged_players',
            ids,
            flagNames: flagNames ?? [],
          })) as
            | Array<{ steamId: string | null; eosId: string | null; flags: string[] }>
            | null
            | undefined) ?? null
        );
      },
      steamSeviyeTazeMi: async (steamId, maxAgeDays, privateMaxAgeDays) =>
        ((await this.opts.sorgu?.({
          kind: 'steam_level_freshness',
          steamId,
          maxAgeDays,
          privateMaxAgeDays,
        })) as { bulundu: boolean; taze: boolean } | null | undefined) ?? null,
      refreshPlayers: () => engine.refreshPlayers(),
      every: (ms, fn) => {
        const z = setInterval(() => {
          // Periyodik iş de yakalanıyor: yakalanmayan bir reddedilme
          // Node'da süreci düşürebilir ve bir plugin bütün agent'ı
          // götürebilirdi.
          void Promise.resolve()
            .then(fn)
            .catch((err) => {
              logger.error({ err, plugin: pluginAdi }, 'plugin periyodik işi hata verdi');
            });
        }, ms);
        zamanlayicilar.push(z);
      },
      sonra: (ms, fn) => {
        // `every` ile AYNI listeye giriyor: kapatma tarafı zaten bu listeyi
        // temizliyor ve Node'da clearInterval bir setTimeout kaydını da
        // iptal ediyor (ikisi de aynı Timeout nesnesi). Ayrı bir liste
        // tutmak, kapatmada birini unutma riski demekti.
        const z = setTimeout(() => {
          void Promise.resolve()
            .then(fn)
            .catch((err) => {
              logger.error({ err, plugin: pluginAdi }, 'plugin gecikmeli işi hata verdi');
            });
        }, ms);
        zamanlayicilar.push(z);
      },
      isaretKoy: (ad, sureSaniye) => {
        this.isaretler.set(ad, Date.now() + sureSaniye * 1000);
      },
      isaretVarMi: (ad) => {
        const biter = this.isaretler.get(ad);
        if (biter === undefined) return false;
        if (Date.now() >= biter) {
          // Süresi geçen işaret temizleniyor: Map sonsuza kadar büyümesin.
          this.isaretler.delete(ad);
          return false;
        }
        return true;
      },
      emit,
      secrets: {
        ...(this.opts.secrets?.steamApiKey ? { steamApiKey: this.opts.secrets.steamApiKey } : {}),
      },
      log: {
        info: (obj, msg) => logger.info({ ...obj, plugin: pluginAdi }, msg),
        warn: (obj, msg) => logger.warn({ ...obj, plugin: pluginAdi }, msg),
        error: (obj, msg) => logger.error({ ...obj, plugin: pluginAdi }, msg),
      },
    };
  }
}

/**
 * RCON metin argümanlarında satır sonu komut enjeksiyonuna yol açar.
 * `apps/agent/src/commands.ts` ile aynı kural — plugin'lerden gelen metin de
 * (panelden yazılıyor) aynı temizlikten geçmeli.
 */
function tekSatir(v: unknown, ustSinir = 300): string {
  return String(v ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, ustSinir);
}

/** Tip yardımcısı: `Plugin<C>` -> host'un kabul ettiği gevşek tip. */
export function tanimla<C>(plugin: Plugin<C>): AnyPlugin {
  return plugin as unknown as AnyPlugin;
}
