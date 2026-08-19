import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { komutAyristir, komutEslesti } from '../chat-command.js';
import { tanimla } from '../plugin-host.js';

/**
 * Oyuncunun kendi maç istatistiğini oyun içinden görmesi (`!stats`).
 *
 * Eski `mystats` plugin'i verisini kendi Mongo koleksiyonundan okuyordu;
 * burada api'ye soruluyor (plan Bölüm 3 — agent Postgres'e dokunmuyor) ve
 * kaynak `round_players`, yani panelin gösterdiğiyle AYNI veri. Eski
 * sistemde bu iki sayı ayrışabiliyordu ve hangisinin doğru olduğu
 * belirsizdi.
 *
 * Sıralama komutu (`!top`) aynı plugin'de: ikisi de aynı veriyi okuyor ve
 * ayrı plugin yapmak, panelde iki ayrı anahtarı birlikte açıp kapatmayı
 * gerektirirdi.
 *
 * İSTATİSTİK YOKSA ile ULAŞILAMADIYSA farklı cevap veriliyor. Oyuncuya
 * "hiç maçın yok" demek, api kopukken yalan söylemek olurdu ve o oyuncu
 * verisinin silindiğini sanırdı.
 */

const Config = z.object({
  command: z.string().trim().min(1).max(32).default('stats'),
  /** Sıralama komutu. Boş bırakılırsa sıralama kapalı. */
  topCommand: z.string().trim().max(32).default('top'),
  prefix: z.string().trim().min(1).max(3).default('!'),
  channels: z
    .array(z.enum(['All', 'Team', 'Squad', 'Admin']))
    .min(1)
    .default(['All', 'Team', 'Squad']),
  /**
   * Kaç gün geriye bakılacak. 0 = tüm zamanlar.
   *
   * Varsayılan tüm zamanlar: oyuncunun sorduğu şey genelde "toplamda ne
   * yaptım". Dönemsel istatistik isteyen sunucular bunu 30'a çekebilir.
   */
  days: z.number().int().min(0).max(3650).default(0),
  /** Sıralamada kaç kişi gösterilecek. */
  topLimit: z.number().int().min(1).max(10).default(5),
  /** Sıralamaya girmek için gereken en az maç. */
  topMinRounds: z.number().int().min(0).max(1000).default(10),
  topMetric: z.enum(['kills', 'kdr', 'revives', 'rounds']).default('kdr'),
  /** Aynı oyuncu kaç saniyede bir sorabilir. */
  cooldownSeconds: z.number().int().min(0).max(600).default(20),
});

type Config = z.infer<typeof Config>;

const OLCUT_ADI: Record<Config['topMetric'], string> = {
  kills: 'öldürme',
  kdr: 'K/D',
  revives: 'canlandırma',
  rounds: 'maç',
};

export const myStats: ReturnType<typeof tanimla> = tanimla({
  name: 'my-stats',
  description: 'Oyuncunun !stats ile kendi maç istatistiğini görmesi ve !top sıralaması.',
  configSchema: Config,

  create(ctx, config: Config) {
    /** steamId -> son sorgu zamanı. */
    const sonSorgu = new Map<string, number>();

    /** Bekleme süresi doldu mu? Dolmadıysa kalan saniye. */
    function beklemeKalan(steamId: string): number {
      if (config.cooldownSeconds <= 0) return 0;
      const son = sonSorgu.get(steamId);
      if (son === undefined) return 0;
      return Math.max(0, Math.ceil((config.cooldownSeconds * 1000 - (Date.now() - son)) / 1000));
    }

    return {
      async onEvent(event) {
        if (event.type !== 'CHAT_MESSAGE') return;

        const komut = komutAyristir(event, config.prefix);
        if (!komut) return;
        if (!config.channels.includes(komut.channel)) return;

        const kendisi = komutEslesti(komut.ad, config.command);
        const siralamaMi =
          config.topCommand.length > 0 && komutEslesti(komut.ad, config.topCommand);
        if (!kendisi && !siralamaMi) return;

        const kalan = beklemeKalan(komut.steamId);
        if (kalan > 0) {
          // Sessiz kalmak, oyuncunun komutun çalışmadığını sanıp arka
          // arkaya tekrar yazmasına yol açıyordu.
          await ctx.rcon.warn(komut.steamId, `Biraz yavaş — ${kalan} sn sonra tekrar dene.`);
          return;
        }
        sonSorgu.set(komut.steamId, Date.now());

        if (siralamaMi) {
          await siralamaGoster(komut.steamId);
          return;
        }
        await kendiIstatistigi(komut.steamId);
      },
    };

    async function kendiIstatistigi(steamId: string) {
      const oyuncular = await ctx.players();
      const kisi = oyuncular.find((p) => p.steamId === steamId);

      const ist = await ctx.oyuncuIstatistigi(
        steamId,
        kisi?.eosId ?? null,
        config.days > 0 ? config.days : null,
      );

      // null = api'ye ulaşılamadı. Bunu "maçın yok" diye göstermek,
      // oyuncuya verisinin silindiğini düşündürürdü.
      if (ist === null) {
        await ctx.rcon.warn(steamId, 'İstatistik şu an alınamıyor, birazdan tekrar dene.');
        ctx.log.warn({ steamId }, 'istatistik sorgusu cevapsız');
        return;
      }

      if (!ist.bulundu || ist.rounds === 0) {
        await ctx.rcon.warn(
          steamId,
          'Henüz kayıtlı maçın yok — bir maç tamamlayınca istatistiğin oluşur.',
        );
        return;
      }

      const donem = config.days > 0 ? ` (son ${config.days} gün)` : '';
      const satirlar = [
        `İstatistiğin${donem}:`,
        `K/D ${ist.kdr} | ${ist.kills} öldürme | ${ist.deaths} ölüm`,
        `${ist.revives} canlandırma | en uzun seri ${ist.bestKillstreak}`,
      ];
      if (ist.winRate !== null) {
        satirlar.push(`${ist.rounds} maç | %${ist.winRate} galibiyet`);
      } else {
        satirlar.push(`${ist.rounds} maç`);
      }
      const enIyiSilah = ist.topWeapons[0];
      if (enIyiSilah) satirlar.push(`En çok: ${enIyiSilah.weapon} (${enIyiSilah.kills})`);

      // Squad'ın uyarı kutusu kısa; tek uzun satır yerine ayrı ayrı
      // gönderiliyor ki hiçbiri kesilmesin.
      for (const satir of satirlar) await ctx.rcon.warn(steamId, satir);
    }

    async function siralamaGoster(steamId: string) {
      const liste = await ctx.siralama({
        metric: config.topMetric,
        limit: config.topLimit,
        days: config.days > 0 ? config.days : null,
        minRounds: config.topMinRounds,
      });

      if (liste === null) {
        await ctx.rcon.warn(steamId, 'Sıralama şu an alınamıyor, birazdan tekrar dene.');
        return;
      }
      if (liste.length === 0) {
        // Eşiği söylemek şart: boş liste "kimse oynamadı" gibi okunurdu,
        // oysa sebep genelde kimsenin eşiği geçmemiş olması.
        await ctx.rcon.warn(
          steamId,
          `Sıralama boş — en az ${config.topMinRounds} maç oynamış kimse yok.`,
        );
        return;
      }

      await ctx.rcon.warn(steamId, `${OLCUT_ADI[config.topMetric]} sıralaması:`);
      let sira = 1;
      for (const s of liste) {
        const deger =
          config.topMetric === 'kills'
            ? `${s.kills} öldürme`
            : config.topMetric === 'revives'
              ? `${s.revives} canlandırma`
              : config.topMetric === 'rounds'
                ? `${s.rounds} maç`
                : `K/D ${s.kdr}`;
        await ctx.rcon.warn(steamId, `${sira}. ${s.name ?? '(bilinmeyen)'} — ${deger}`);
        sira++;
      }
    }
  },
} satisfies Plugin<Config>);
