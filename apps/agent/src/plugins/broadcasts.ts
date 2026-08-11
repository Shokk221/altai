import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { tanimla } from '../plugin-host.js';

/**
 * Belirli aralıklarla sunucuya duyuru basar (kurallar, Discord daveti...).
 *
 * Eski sistemdeki `broadcasts` plugin'inin karşılığı. Davranışta iki
 * bilinçli fark var:
 *
 *  1. Mesajlar SIRAYLA gidiyor, rastgele değil. Rastgele seçimde aynı mesaj
 *     üst üste iki kez çıkabiliyor ve oyuncular listenin tamamını hiç
 *     görmeyebiliyor.
 *  2. Sunucu BOŞKEN duyuru yapılmıyor. Kimsenin olmadığı sunucuya duyuru
 *     basmak yalnızca log şişiriyor.
 */

const Config = z.object({
  /** Sırayla basılacak mesajlar. */
  messages: z.array(z.string().trim().min(1).max(250)).min(1),
  /** İki duyuru arası dakika. */
  intervalMinutes: z.number().int().min(1).max(180).default(15),
  /** Bu sayıdan az oyuncu varsa duyuru yapılmaz. */
  minPlayers: z.number().int().min(0).max(100).default(1),
});

type Config = z.infer<typeof Config>;

export const broadcasts: ReturnType<typeof tanimla> = tanimla({
  name: 'broadcasts',
  description: 'Belirli aralıklarla sunucuya sırayla duyuru basar.',
  configSchema: Config,

  create(ctx, config: Config) {
    // Sıra göstergesi kapanışta sıfırlanıyor (plugin nesnesi değil bu kapanış
    // durumu tutuyor): hot-reload sonrası baştan başlamak, mesaj listesi
    // değiştiğinde eski indeksle yanlış mesaja denk gelmekten iyi.
    let sira = 0;

    ctx.every(config.intervalMinutes * 60_000, async () => {
      const oyuncular = await ctx.players();
      if (oyuncular.length < config.minPlayers) return;

      const mesaj = config.messages[sira % config.messages.length];
      if (!mesaj) return;
      sira += 1;

      await ctx.rcon.broadcast(mesaj);
      ctx.log.info({ mesaj, oyuncu: oyuncular.length }, 'duyuru yapıldı');
    });

    return {};
  },
} satisfies Plugin<Config>);
