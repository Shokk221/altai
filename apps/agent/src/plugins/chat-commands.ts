import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { komutAyristir, komutEslesti } from '../chat-command.js';
import { tanimla } from '../plugin-host.js';

/**
 * Panelden tanımlanan sabit cevaplı sohbet komutları.
 *
 * `!discord`, `!kurallar` gibi şeyler için. Cevap metni ayarda durduğu için
 * yeni bir komut eklemek kod değişikliği gerektirmiyor — eski sistemde de
 * böyleydi ve korundu.
 *
 * Eski plugin'de `ignoreChats` vardı; burada tersine çevrildi: hangi
 * kanallarda ÇALIŞACAĞI yazılıyor. Sebep pratik — "adminlere özel komut"
 * yapmak isteyen kişi eskiden geri kalan üç kanalı tek tek saymak
 * zorundaydı ve biri unutulduğunda komut herkese açık kalıyordu. Bu sessiz
 * bir yetki sızıntısı.
 */

const Komut = z.object({
  /** Ön eksiz komut adı ("discord" -> `!discord`). */
  command: z.string().trim().min(1).max(32),
  /** `warn` yalnızca çağırana, `broadcast` herkese. */
  type: z.enum(['warn', 'broadcast']),
  response: z.string().trim().min(1).max(200),
  /** Komutun çalışacağı kanallar. Boş bırakılırsa hepsi. */
  channels: z.array(z.enum(['All', 'Team', 'Squad', 'Admin'])).default([]),
  /** Yalnızca gerçek adminler kullanabilsin mi. */
  adminOnly: z.boolean().default(false),
});

const Config = z.object({
  prefix: z.string().trim().min(1).max(3).default('!'),
  commands: z.array(Komut).default([]),
});

type Config = z.infer<typeof Config>;

export const chatCommands: ReturnType<typeof tanimla> = tanimla({
  name: 'chat-commands',
  description: 'Panelden tanımlanan sabit cevaplı sohbet komutları.',
  configSchema: Config,

  create(ctx, config: Config) {
    return {
      async onEvent(event) {
        if (event.type !== 'CHAT_MESSAGE') return;

        const komut = komutAyristir(event, config.prefix);
        if (!komut) return;

        for (const tanim of config.commands) {
          if (!komutEslesti(komut.ad, tanim.command)) continue;

          if (tanim.channels.length > 0 && !tanim.channels.includes(komut.channel)) continue;

          // Yetki kontrolü kanaldan AYRI: admin sohbetine erişimi olmayan
          // ama yetkisi olan biri de komutu başka kanaldan kullanabilmeli.
          if (tanim.adminOnly && !ctx.gercekAdminMi(komut.steamId, null)) continue;

          if (tanim.type === 'broadcast') {
            await ctx.rcon.broadcast(tanim.response);
          } else {
            await ctx.rcon.warn(komut.steamId, tanim.response);
          }
          return;
        }
      },
    };
  },
} satisfies Plugin<Config>);
