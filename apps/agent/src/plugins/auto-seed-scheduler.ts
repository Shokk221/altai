import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { tanimla } from '../plugin-host.js';

/**
 * Sunucu boşaldığında seed haritasına geçer.
 *
 * İki tetikleyicisi var ve eşikleri BİLİNÇLİ olarak farklı:
 *  - Günün belirli saatinde (gece boşalması) — çok düşük eşik, çünkü o
 *    saatte kalan birkaç kişiyi haritadan atmamak gerekiyor.
 *  - Round bitişinde — daha yüksek eşik, çünkü maç zaten bitmiş ve bir
 *    sonraki maç zaten yeni harita demek.
 *
 * Zamanlayıcıyı host tutuyor (`ctx.every`). Eski plugin kendi
 * `setTimeout`'unu kurup her tetiklemede yenisini zincirliyordu; hot-reload
 * her seferinde bir zamanlayıcı daha bırakıyor ve harita günde birkaç kez
 * değişmeye başlıyordu. Burada dakikada bir "saat geldi mi" diye bakılıyor:
 * zincirleme yok, kaçırılan tetikleme yok.
 */

const Config = z.object({
  /** Geçişin yapılacağı saat (0-23, sunucunun yerel saati). */
  hour: z.number().int().min(0).max(23).default(7),
  minute: z.number().int().min(0).max(59).default(0),
  /** Geçilecek harita. */
  layer: z.string().trim().min(1).max(100).default('Sumari_Seed_v1'),
  /** Zamanlanmış geçiş için üst oyuncu sınırı (üstündeyse atlanır). */
  maxPlayersToSwitch: z.number().int().min(0).max(100).default(10),
  /** Round bitişinde bu sayının altındaysa seed haritasına geçilir. */
  roundEndPlayerThreshold: z.number().int().min(0).max(100).default(25),
  /** Sunucu zaten seed haritasındaysa geçişi atla. */
  skipIfAlreadySeed: z.boolean().default(true),
  /** Seed sayılan harita modları. */
  seedGamemodes: z.array(z.string().trim().min(1)).min(1).default(['seed', 'training']),
  /** Round bitiminden kaç saniye sonra karar verilir. */
  roundEndDelaySeconds: z.number().int().min(0).max(120).default(5),
});

type Config = z.infer<typeof Config>;

export const autoSeedScheduler: ReturnType<typeof tanimla> = tanimla({
  name: 'auto-seed-scheduler',
  description: 'Belirlenen saatte ve round sonunda sunucu boşsa seed haritasına geçer.',
  configSchema: Config,

  create(ctx, config: Config) {
    const seedModlari = config.seedGamemodes.map((g) => g.toLowerCase());
    let kapali = false;
    /** Aynı dakikada iki kez tetiklenmeyi engeller. */
    let sonTetikGunu = '';

    async function zatenSeedMi(): Promise<boolean> {
      if (!config.skipIfAlreadySeed) return false;
      const durum = await ctx.status();
      const layer = (durum.currentLayer ?? '').toLowerCase();
      return seedModlari.some((g) => layer.includes(g));
    }

    async function haritayiDegistir(sebep: string) {
      // Harita adı doğrudan RCON'a gidiyor; ayar panelden geliyor ve
      // boşluk içeren bir değer komutu ikiye bölerdi.
      if (/\s/.test(config.layer)) {
        ctx.log.error({ layer: config.layer }, 'seed haritası adında boşluk var — geçiş yapılmadı');
        return;
      }
      await ctx.rcon.execute(`AdminChangeLayer ${config.layer}`);
      ctx.log.info({ layer: config.layer, sebep }, 'seed haritasına geçildi');
    }

    // Dakikada bir: hedef saat geldi mi?
    ctx.every(60_000, async () => {
      const simdi = new Date();
      if (simdi.getHours() !== config.hour || simdi.getMinutes() !== config.minute) return;

      const gun = simdi.toDateString();
      if (sonTetikGunu === gun) return;
      sonTetikGunu = gun;

      if (await zatenSeedMi()) {
        ctx.log.info({}, 'zamanlanmış geçiş atlandı: sunucu zaten seed haritasında');
        return;
      }

      const durum = await ctx.status();
      if (durum.playerCount > config.maxPlayersToSwitch) {
        ctx.log.info(
          { oyuncu: durum.playerCount, sinir: config.maxPlayersToSwitch },
          'zamanlanmış geçiş atlandı: sunucu yeterince dolu',
        );
        return;
      }

      await haritayiDegistir('zamanlanmış');
    });

    return {
      async onEvent(event) {
        if (event.type !== 'ROUND_ENDED') return;

        // Round bitiminde oyuncu sayısı henüz oturmamış oluyor.
        if (config.roundEndDelaySeconds > 0) {
          await new Promise((r) => setTimeout(r, config.roundEndDelaySeconds * 1000));
          if (kapali) return;
        }

        if (await zatenSeedMi()) return;

        const durum = await ctx.status();
        if (durum.playerCount >= config.roundEndPlayerThreshold) return;

        await haritayiDegistir('round sonu');
      },

      onDisable() {
        kapali = true;
      },
    };
  },
} satisfies Plugin<Config>);
