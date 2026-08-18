import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { komutAyristir, komutEslesti } from '../chat-command.js';
import { tanimla } from '../plugin-host.js';

/**
 * Oyuncunun oyun içinden yetkili çağırması (`!admin <sebep>`).
 *
 * Eski sistemde bu doğrudan Discord'a yazan bir plugin'di; burada olay
 * üretiliyor ve bot render ediyor (plan Bölüm 6). Fark yalnızca mimari
 * değil: Discord kesintisi artık çağrının KAYDINI etkilemiyor, olay
 * `raw_events`'e yazıldığı için sonradan da görülebiliyor.
 *
 * SEBEP ZORUNLU DEĞİL. Oyuncu aceleyle yalnızca `!admin` yazmış olabilir
 * ve çağrıyı "sebep yok" diye düşürmek, gerçekten yardım isteyen birini
 * görmezden gelmek olurdu. Sebep boşsa bot da öyle gösteriyor.
 *
 * Çağıran oyuncuya HER ZAMAN bir cevap gidiyor — bekleme süresine
 * takıldığında bile. Sessiz kalmak, oyuncunun komutun çalışmadığını
 * sanıp arka arkaya tekrar yazmasına yol açıyordu.
 */

const Config = z.object({
  command: z.string().trim().min(1).max(32).default('admin'),
  prefix: z.string().trim().min(1).max(3).default('!'),
  /** Komutun kabul edileceği kanallar. */
  channels: z
    .array(z.enum(['All', 'Team', 'Squad', 'Admin']))
    .min(1)
    .default(['All', 'Team', 'Squad']),
  /** Aynı oyuncu kaç saniyede bir çağrı yapabilir. */
  cooldownSeconds: z.number().int().min(0).max(3600).default(120),
  /** Sebep en fazla kaç karakter (fazlası kırpılır). */
  maxReasonLength: z.number().int().min(20).max(500).default(200),
  ackMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('Çağrın yetkililere iletildi. Lütfen bekle.'),
  /** Sunucuda hiç yetkili yokken gösterilecek ek uyarı. */
  noAdminMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('Şu an sunucuda yetkili yok; çağrın Discord üzerinden iletildi.'),
});

type Config = z.infer<typeof Config>;

export const adminRequest: ReturnType<typeof tanimla> = tanimla({
  name: 'admin-request',
  description: 'Oyuncuların !admin komutuyla yetkili çağırmasını sağlar.',
  configSchema: Config,

  create(ctx, config: Config) {
    /** steamId -> son çağrı zamanı. */
    const sonCagri = new Map<string, number>();

    return {
      async onEvent(event) {
        if (event.type !== 'CHAT_MESSAGE') return;

        const komut = komutAyristir(event, config.prefix);
        if (!komut || !komutEslesti(komut.ad, config.command)) return;
        if (!config.channels.includes(komut.channel)) return;

        const simdi = Date.now();
        const son = sonCagri.get(komut.steamId);
        if (son !== undefined && config.cooldownSeconds > 0) {
          const kalan = Math.ceil((config.cooldownSeconds * 1000 - (simdi - son)) / 1000);
          if (kalan > 0) {
            await ctx.rcon.warn(komut.steamId, `Çağrın zaten iletildi. ${kalan} sn bekle.`);
            return;
          }
        }
        sonCagri.set(komut.steamId, simdi);

        const oyuncular = await ctx.players();
        const cagiran = oyuncular.find((p) => p.steamId === komut.steamId);

        // Sunucudaki yetkili sayısı: bot bunu gösteriyor, çünkü "kimse yok"
        // ile "üç kişi var ama bakmıyor" moderatör için farklı durumlar.
        const cevrimiciYetkili = oyuncular.filter((p) =>
          ctx.gercekAdminMi(p.steamId, p.eosId),
        ).length;

        const sebep = komut.arguman.trim().slice(0, config.maxReasonLength);

        ctx.emit({
          type: 'ADMIN_REQUEST',
          serverSlug: ctx.serverSlug,
          playerName: cagiran?.name ?? '(bilinmeyen)',
          steamId: komut.steamId,
          ...(cagiran?.eosId ? { eosId: cagiran.eosId } : {}),
          ...(sebep ? { reason: sebep } : {}),
          onlineAdmins: cevrimiciYetkili,
          timestamp: new Date().toISOString(),
        });

        await ctx.rcon.warn(
          komut.steamId,
          cevrimiciYetkili > 0 ? config.ackMessage : config.noAdminMessage,
        );
        ctx.log.info(
          { oyuncu: cagiran?.name, sebep: sebep || '(yok)', cevrimiciYetkili },
          'yetkili çağrısı',
        );
      },
    };
  },
} satisfies Plugin<Config>);
