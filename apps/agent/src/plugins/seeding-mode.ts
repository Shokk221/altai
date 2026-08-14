import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { tanimla } from '../plugin-host.js';

/**
 * Sunucu doluyorken seed kurallarını duyurur, dolunca "canlı" mesajını verir.
 *
 * Eski plugin'de üç davranış vardı ve üçü de korundu:
 *  - eşiğin altında seed kuralları,
 *  - eşik ile "canlı" eşiği arasında canlı mesajı,
 *  - sunucu BOŞKEN hiç duyuru yok (kimse yokken yayın yapmak anlamsız).
 *
 * Yeni harita başladığında kısa bir sessizlik var: harita geçişinin hemen
 * ardından oyuncu sayısı henüz oturmamış oluyor ve o anki sayıya bakarak
 * "seed kuralları" duyurmak, dolu bir sunucuda yanlış mesaj demekti.
 */

const Config = z.object({
  /** Duyuru sıklığı (saniye). */
  intervalSeconds: z.number().int().min(30).max(3600).default(150),
  /** Bu sayının altında seed kuralları duyurulur. */
  seedingThreshold: z.number().int().min(0).max(100).default(50),
  seedingMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('Seed kuralları geçerli! Sadece orta bayrakta çatışın, FOB avı yok!'),
  /** "Canlı" mesajı açık mı. */
  liveEnabled: z.boolean().default(true),
  /** Bu sayının altındayken (ve seed eşiğinin üstünde) canlı mesajı gider. */
  liveThreshold: z.number().int().min(0).max(100).default(52),
  liveMessage: z.string().trim().min(1).max(200).default('Sunucu canlı!'),
  /** Yeni harita sonrası kaç saniye duyuru yapılmaz. */
  newGameQuietSeconds: z.number().int().min(0).max(300).default(30),
});

type Config = z.infer<typeof Config>;

export const seedingMode: ReturnType<typeof tanimla> = tanimla({
  name: 'seeding-mode',
  description: 'Sunucu dolarken seed kurallarını, dolunca canlı mesajını duyurur.',
  configSchema: Config,

  create(ctx, config: Config) {
    /** Bu zamana kadar duyuru yapılmaz (harita geçişi sessizliği). */
    let sessizlikBitisi = 0;

    ctx.every(config.intervalSeconds * 1000, async () => {
      if (Date.now() < sessizlikBitisi) return;

      const durum = await ctx.status();
      // Boş sunucuda duyuru yok.
      if (durum.playerCount === 0) return;

      if (durum.playerCount < config.seedingThreshold) {
        await ctx.rcon.broadcast(config.seedingMessage);
        return;
      }

      if (config.liveEnabled && durum.playerCount < config.liveThreshold) {
        await ctx.rcon.broadcast(config.liveMessage);
      }
    });

    return {
      onEvent(event) {
        if (event.type !== 'ROUND_STARTED') return;
        sessizlikBitisi = Date.now() + config.newGameQuietSeconds * 1000;
      },
    };
  },
} satisfies Plugin<Config>);
