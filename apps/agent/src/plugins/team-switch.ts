import type { Plugin, SquadJSOnlinePlayer } from '@altai/squad';
import { z } from 'zod';
import { komutAyristir, komutEslesti } from '../chat-command.js';
import { tanimla } from '../plugin-host.js';

/**
 * Oyuncunun kendi isteğiyle takım değiştirmesi (`!switch`) ve takılan
 * oyuncunun kurtarılması (`!bug`).
 *
 * İki komut çok farklı işler ve kuralları da ayrı:
 *
 *  - `!switch` KARŞI TARAFA geçirir. Dengeyi bozabildiği için sınırlı:
 *    maçın ilk dakikalarında, kişi başına uzun bir bekleme süresiyle ve
 *    yalnızca takımlar arası fark açılmıyorsa.
 *
 *  - `!bug` AYNI TARAFA geri getirir (çift geçiş). Amacı dengeyi
 *    değiştirmek değil, haritada takılıp kalmış oyuncuyu kurtarmak. Bu
 *    yüzden denge kontrolü uygulanmıyor — zaten net etkisi sıfır.
 *
 * KARIŞTIRMA SONRASI KİLİT: takım dengeleyici karıştırma yaptıktan sonra
 * `scramble` işareti bırakıyor ve burası o işaret dururken hiçbir geçişe
 * izin vermiyor. Olmasaydı karıştırılan oyuncular anında eski taraflarına
 * döner ve yapılan iş boşa giderdi.
 *
 * BEKLEME SÜRELERİ BELLEKTE. Agent yeniden başlarsa sıfırlanıyorlar.
 * Kalıcılaştırmak her istekte bir veritabanı turu demekti; karşılığında
 * kazanılan şey, nadir bir yeniden başlatmadan sonra birinin ikinci kez
 * geçebilmesi. Bu takas bilinçli.
 */

const Config = z.object({
  /** Takım değiştirme komutları. */
  switchCommands: z.array(z.string().trim().min(1)).min(1).default(['switch', 'change']),
  /** Çift geçiş (takılma kurtarma) komutları. */
  doubleSwitchCommands: z.array(z.string().trim().min(1)).min(1).default(['bug', 'stuck']),
  prefix: z.string().trim().min(1).max(3).default('!'),

  /** Maç başladıktan sonra kaç dakika boyunca `!switch` açık kalır. */
  switchEnabledMinutes: z.number().int().min(0).max(180).default(5),
  /** Aynı oyuncu kaç saat sonra tekrar geçebilir. */
  switchCooldownHours: z.number().min(0).max(24).default(3),
  /**
   * Takımlar arası fark bu değeri aşacaksa geçiş reddedilir.
   *
   * Geçiş SONRASI duruma bakılıyor: kalabalık taraftan az olana geçmek
   * her zaman serbest, tersi ise farkı açmıyorsa serbest.
   */
  maxUnbalancedSlots: z.number().int().min(0).max(20).default(3),

  /** Çift geçişte iki komut arasındaki bekleme (ms). */
  doubleSwitchDelayMs: z.number().int().min(100).max(5000).default(1000),
  /** Çift geçiş için bekleme süresi (saat). */
  doubleSwitchCooldownHours: z.number().min(0).max(24).default(0.5),

  /** Karıştırma sonrası kaç dakika geçiş kapalı kalır. */
  scrambleLockdownMinutes: z.number().int().min(0).max(120).default(20),

  /**
   * Karşı tarafta daha çok klan arkadaşı varsa bekleme ve süre sınırı
   * atlanır. Klanla oynamak isteyen oyuncu için asıl kural bu.
   */
  enableClanBasedSwitch: z.boolean().default(true),
});

type Config = z.infer<typeof Config>;

/** Takım dengeleyicinin karıştırma sonrası bıraktığı işaret. */
export const KARISTIRMA_ISARETI = 'scramble';

function kimlik(p: SquadJSOnlinePlayer): string | null {
  return p.eosId ?? p.steamId ?? null;
}

/**
 * Geçiş dengeyi kabul edilemez hâle getirir mi?
 *
 * Geçiş SONRASINDAKİ duruma bakılıyor, öncesine değil: 40-40 iken bir
 * kişinin geçmesi 39-41 yapar ve fark 2'dir. Öncesine bakan bir kontrol
 * "zaten dengeliydi" deyip geçişe izin verirdi.
 */
export function dengeBozuluyorMu(kaynakSayi: number, hedefSayi: number, maxFark: number): boolean {
  const sonrakiFark = Math.abs(hedefSayi + 1 - (kaynakSayi - 1));
  const oncekiFark = Math.abs(hedefSayi - kaynakSayi);
  // Farkı KÜÇÜLTEN geçiş her zaman serbest: kalabalık taraftan az olana
  // geçmek dengeyi düzeltiyor.
  if (sonrakiFark <= oncekiFark) return false;
  return sonrakiFark > maxFark;
}

export const teamSwitch: ReturnType<typeof tanimla> = tanimla({
  name: 'team-switch',
  description: 'Oyuncuların !switch ile takım değiştirmesi ve !bug ile takılmadan kurtulması.',
  configSchema: Config,

  create(ctx, config: Config) {
    /** steamId -> son geçiş zamanı. */
    const sonGecis = new Map<string, number>();
    /** steamId -> son çift geçiş zamanı. */
    const sonCiftGecis = new Map<string, number>();
    /** Maçın başlama zamanı; süre sınırı buradan ölçülüyor. */
    let macBaslangici = Date.now();
    let kapali = false;

    const kalanSaniye = (son: number, saat: number) =>
      Math.ceil((saat * 3600_000 - (Date.now() - son)) / 1000);

    /** Karşı tarafta daha çok klan arkadaşı var mı? */
    async function klanKarsidaMi(
      oyuncu: SquadJSOnlinePlayer,
      oyuncular: SquadJSOnlinePlayer[],
    ): Promise<boolean> {
      if (!config.enableClanBasedSwitch) return false;

      const kimlikler = oyuncular.map(kimlik).filter((k): k is string => k !== null);
      const cevap = await ctx.oyuncuKlanlari(kimlikler);
      // Bilinmiyorsa muafiyet YOK: bilmediğimiz bir gerekçeyle kuralı
      // gevşetmek, kuralı hiç koymamakla aynı kapıya çıkar.
      if (cevap === null) return false;

      const klanAdi = new Map<string, string>();
      for (const c of cevap) {
        if (c.steamId) klanAdi.set(c.steamId, c.clan);
        if (c.eosId) klanAdi.set(c.eosId.toLowerCase(), c.clan);
      }

      const benimKlanim =
        klanAdi.get(oyuncu.steamId ?? '') ?? klanAdi.get(oyuncu.eosId?.toLowerCase() ?? '');
      if (!benimKlanim) return false;

      let kendiTarafta = 0;
      let karsida = 0;
      for (const p of oyuncular) {
        const k = klanAdi.get(p.steamId ?? '') ?? klanAdi.get(p.eosId?.toLowerCase() ?? '');
        if (k !== benimKlanim) continue;
        if (p.teamId === oyuncu.teamId) kendiTarafta++;
        else karsida++;
      }

      // Kendisi de kendi tarafında sayıldığı için eşitlik yeterli değil.
      return karsida > kendiTarafta;
    }

    async function gecisIste(steamId: string) {
      if (ctx.isaretVarMi(KARISTIRMA_ISARETI)) {
        await ctx.rcon.warn(steamId, 'Takımlar yeni dengelendi, geçiş şu an kapalı.');
        return;
      }

      const oyuncular = await ctx.players();
      const oyuncu = oyuncular.find((p) => p.steamId === steamId);
      if (!oyuncu || oyuncu.teamId === null) {
        await ctx.rcon.warn(steamId, 'Oyuncu bilgin okunamadı, birazdan tekrar dene.');
        return;
      }

      const klanMuafiyeti = await klanKarsidaMi(oyuncu, oyuncular);

      // Süre sınırı ve bekleme, klan muafiyetiyle atlanıyor.
      if (!klanMuafiyeti) {
        const gecenDakika = (Date.now() - macBaslangici) / 60_000;
        if (config.switchEnabledMinutes > 0 && gecenDakika > config.switchEnabledMinutes) {
          await ctx.rcon.warn(
            steamId,
            `Takım değiştirme yalnızca maçın ilk ${config.switchEnabledMinutes} dakikasında açık.`,
          );
          return;
        }

        const son = sonGecis.get(steamId);
        if (son !== undefined && config.switchCooldownHours > 0) {
          const kalan = kalanSaniye(son, config.switchCooldownHours);
          if (kalan > 0) {
            await ctx.rcon.warn(steamId, `Tekrar geçmek için ${Math.ceil(kalan / 60)} dk bekle.`);
            return;
          }
        }
      }

      // Denge kontrolü klan muafiyetinde DE uygulanıyor: klanla oynamak
      // isteği, maçı 20 kişi farkla oynatmayı haklı çıkarmıyor.
      const kaynak = oyuncular.filter((p) => p.teamId === oyuncu.teamId).length;
      const hedef = oyuncular.filter((p) => p.teamId !== null && p.teamId !== oyuncu.teamId).length;

      if (dengeBozuluyorMu(kaynak, hedef, config.maxUnbalancedSlots)) {
        await ctx.rcon.warn(steamId, 'Takımlar dengesiz olacağı için geçiş yapılamıyor.');
        return;
      }

      const k = kimlik(oyuncu);
      if (!k) return;

      await ctx.rcon.switchTeam(k);
      sonGecis.set(steamId, Date.now());
      await ctx.rcon.warn(steamId, 'Takımın değiştirildi.');
      ctx.log.info({ oyuncu: oyuncu.name, klanMuafiyeti }, 'takım değiştirildi');
    }

    async function ciftGecis(steamId: string) {
      const son = sonCiftGecis.get(steamId);
      if (son !== undefined && config.doubleSwitchCooldownHours > 0) {
        const kalan = kalanSaniye(son, config.doubleSwitchCooldownHours);
        if (kalan > 0) {
          await ctx.rcon.warn(steamId, `Tekrar kullanmak için ${Math.ceil(kalan / 60)} dk bekle.`);
          return;
        }
      }

      const oyuncular = await ctx.players();
      const oyuncu = oyuncular.find((p) => p.steamId === steamId);
      if (!oyuncu) {
        await ctx.rcon.warn(steamId, 'Oyuncu bilgin okunamadı, birazdan tekrar dene.');
        return;
      }

      const k = kimlik(oyuncu);
      if (!k) return;

      // Denge kontrolü YOK: net etki sıfır, oyuncu geldiği tarafa dönüyor.
      sonCiftGecis.set(steamId, Date.now());
      await ctx.rcon.switchTeam(k);
      await new Promise((r) => setTimeout(r, config.doubleSwitchDelayMs));
      // Bekleme sırasında plugin kapatılmış olabilir; oyuncuyu karşı
      // tarafta bırakmak, hiç yapmamaktan kötü.
      if (kapali) {
        ctx.log.warn({ oyuncu: oyuncu.name }, 'çift geçiş yarıda kaldı — plugin kapandı');
        return;
      }
      await ctx.rcon.switchTeam(k);
      await ctx.rcon.warn(steamId, 'Takıldığın yerden kurtarıldın.');
    }

    return {
      async onEvent(event) {
        if (event.type === 'ROUND_STARTED') {
          macBaslangici = Date.now();
          // Bekleme süreleri maça DEĞİL saate bağlı: yeni maçta
          // sıfırlanmıyorlar, yoksa 3 saatlik sınır anlamını yitirirdi.
          return;
        }

        if (event.type !== 'CHAT_MESSAGE') return;

        const komut = komutAyristir(event, config.prefix);
        if (!komut) return;

        if (config.switchCommands.some((c) => komutEslesti(komut.ad, c))) {
          await gecisIste(komut.steamId);
          return;
        }

        if (config.doubleSwitchCommands.some((c) => komutEslesti(komut.ad, c))) {
          await ciftGecis(komut.steamId);
        }
      },

      onDisable() {
        kapali = true;
      },
    };
  },
} satisfies Plugin<Config>);
