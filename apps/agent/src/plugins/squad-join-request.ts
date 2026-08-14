import type { Plugin, SquadJSOnlinePlayer } from '@altai/squad';
import { z } from 'zod';
import { komutAyristir, komutEslesti } from '../chat-command.js';
import { tanimla } from '../plugin-host.js';

/**
 * Oyuncunun manga liderine katılma isteği göndermesi (`!katıl 3`).
 *
 * Kilitli mangaya girmek isteyen oyuncu, lideri sesli olarak rahatsız etmek
 * yerine bu komutu kullanıyor; lider ekranında bir uyarı görüyor.
 *
 * Eski plugin `!katıl 3,5,7` gibi virgüllü liste kabul ediyordu. Bu
 * korundu ama SINIRLANDI: liste uzunluğu sınırsızdı ve `!katıl` ardına
 * yüzlerce numara yazan biri, tek mesajla sunucudaki her lidere uyarı
 * gönderebiliyordu. Artık hem numara sayısı hem de kişi başına sıklık
 * sınırlı.
 *
 * `CHAT_MESSAGE` yalnızca SteamID taşıyor; oyuncunun takımı ve mangası
 * RCON listesinden çözülüyor.
 */

const Config = z.object({
  command: z.string().trim().min(1).max(32).default('katıl'),
  prefix: z.string().trim().min(1).max(3).default('!'),
  /** Tek mesajda en fazla kaç mangaya istek gönderilebilir. */
  maxSquadsPerRequest: z.number().int().min(1).max(10).default(3),
  /** Aynı oyuncu kaç saniyede bir istek gönderebilir. */
  cooldownSeconds: z.number().int().min(0).max(600).default(30),
  /** Komutun çalışacağı kanallar. */
  channels: z
    .array(z.enum(['All', 'Team', 'Squad', 'Admin']))
    .min(1)
    .default(['All', 'Team']),
});

type Config = z.infer<typeof Config>;

function kimlik(p: SquadJSOnlinePlayer): string | null {
  return p.eosId ?? p.steamId ?? null;
}

export const squadJoinRequest: ReturnType<typeof tanimla> = tanimla({
  name: 'squad-join-request',
  description: 'Oyuncuların manga liderlerine katılma isteği göndermesini sağlar.',
  configSchema: Config,

  create(ctx, config: Config) {
    /** steamId -> son istek zamanı. */
    const sonIstek = new Map<string, number>();

    return {
      async onEvent(event) {
        if (event.type !== 'CHAT_MESSAGE') return;

        const komut = komutAyristir(event, config.prefix);
        if (!komut || !komutEslesti(komut.ad, config.command)) return;
        if (!config.channels.includes(komut.channel)) return;

        const simdi = Date.now();
        const son = sonIstek.get(komut.steamId);
        if (son !== undefined && simdi - son < config.cooldownSeconds * 1000) {
          const kalan = Math.ceil((config.cooldownSeconds * 1000 - (simdi - son)) / 1000);
          await ctx.rcon.warn(komut.steamId, `Çok sık istek gönderiyorsun. ${kalan} sn bekle.`);
          return;
        }

        const numaralar = komut.arguman
          .split(',')
          .map((n) => Number.parseInt(n.trim(), 10))
          .filter((n) => Number.isInteger(n) && n > 0);

        if (numaralar.length === 0) {
          await ctx.rcon.warn(
            komut.steamId,
            `Kullanım: ${config.prefix}${config.command} <manga numarası>`,
          );
          return;
        }

        const oyuncular = await ctx.players();
        const isteyen = oyuncular.find((p) => p.steamId === komut.steamId);
        if (!isteyen) {
          // RCON listesi henüz tazelenmemiş olabilir; sessizce düşürmek
          // yerine söylüyoruz, yoksa oyuncu komutun çalışmadığını sanır.
          await ctx.rcon.warn(komut.steamId, 'Oyuncu bilgin okunamadı, birazdan tekrar dene.');
          return;
        }

        // Tekrarlanan numaralar sayılmasın: `!katıl 3,3,3` tek mangaya
        // üç uyarı gönderirdi.
        const benzersiz = [...new Set(numaralar)].slice(0, config.maxSquadsPerRequest);
        sonIstek.set(komut.steamId, simdi);

        for (const squadId of benzersiz) {
          const lider = oyuncular.find(
            (p) => p.teamId === isteyen.teamId && p.squadId === squadId && p.isLeader,
          );

          if (!lider) {
            await ctx.rcon.warn(komut.steamId, `Manga ${squadId} bulunamadı ya da lideri yok.`);
            continue;
          }

          const liderKimlik = kimlik(lider);
          if (!liderKimlik) continue;

          await ctx.rcon.warn(liderKimlik, `${isteyen.name} manganıza katılmak istiyor.`);
          await ctx.rcon.warn(komut.steamId, `İstek manga ${squadId} liderine iletildi.`);
        }
      },
    };
  },
} satisfies Plugin<Config>);
