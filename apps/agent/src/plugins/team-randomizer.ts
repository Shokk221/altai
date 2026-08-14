import type { Plugin, SquadJSOnlinePlayer } from '@altai/squad';
import { z } from 'zod';
import { komutAyristir, komutEslesti } from '../chat-command.js';
import { tanimla } from '../plugin-host.js';

/**
 * Takımları rastgele dağıtır (`!randomize`, admin sohbetinden).
 *
 * Klan yığılmasını dağıtmak ve etkinlikler için. Eski plugin'in mantığı
 * korundu: listeyi karıştır, sırayla 1-2-1-2 diye dağıt, zaten doğru
 * takımda olanı atlama.
 *
 * ÜÇ ŞEY DEĞİŞTİ ve üçünün de sebebi var:
 *
 * 1. Yalnızca GERÇEK ADMİN çalıştırabiliyor. Eskiden tek kontrol "mesaj
 *    admin kanalından mı geldi" idi; o kanala erişebilen ama yetkisi
 *    olmayan biri bütün sunucunun takımını değiştirebiliyordu.
 *
 * 2. Manga liderleri istenirse korunuyor. Eski plugin herkesi karıştırıyor,
 *    liderler mangalarından koparılıyor ve maç başında mangalar dağılıyordu.
 *
 * 3. Komutlar sırayla ve aralıklı gönderiliyor. 80 kişilik bir sunucuda
 *    `AdminForceTeamChange`'i tek seferde ardı ardına basmak RCON'u
 *    boğuyordu; eski plugin bunu `await` ile yapıyordu ama arada bekleme
 *    yoktu.
 */

const Config = z.object({
  /** Ön eksiz komut adı. */
  command: z.string().trim().min(1).max(32).default('randomize'),
  prefix: z.string().trim().min(1).max(3).default('!'),
  /** Komutun kabul edileceği kanallar. */
  channels: z
    .array(z.enum(['All', 'Team', 'Squad', 'Admin']))
    .min(1)
    .default(['Admin']),
  /** Manga liderleri yerinde bırakılsın mı. */
  keepSquadLeaders: z.boolean().default(true),
  /** İki komut arasındaki bekleme (ms) — RCON'u boğmamak için. */
  commandDelayMs: z.number().int().min(0).max(2000).default(150),
  /** Bu sayıdan az oyuncu varken çalışmaz. */
  minPlayers: z.number().int().min(0).max(100).default(4),
  announceMessage: z.string().trim().max(200).default('Takımlar karıştırıldı.'),
});

type Config = z.infer<typeof Config>;

/** Fisher-Yates — eski plugin'in kullandığı karıştırmanın aynısı. */
function karistir<T>(dizi: T[]): T[] {
  const d = [...dizi];
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = d[i];
    const b = d[j];
    if (a !== undefined && b !== undefined) {
      d[i] = b;
      d[j] = a;
    }
  }
  return d;
}

function kimlik(p: SquadJSOnlinePlayer): string | null {
  return p.eosId ?? p.steamId ?? null;
}

export const teamRandomizer: ReturnType<typeof tanimla> = tanimla({
  name: 'team-randomizer',
  description: 'Admin komutuyla takımları rastgele dağıtır.',
  configSchema: Config,

  create(ctx, config: Config) {
    let calisiyor = false;
    let kapali = false;

    async function karistirVeDagit() {
      // Aynı anda iki kez çalışması, oyuncuların yarısını iki kez
      // değiştirip dağılımı bozardı.
      if (calisiyor) return;
      calisiyor = true;
      try {
        await ctx.refreshPlayers();
        const hepsi = await ctx.players();

        if (hepsi.length < config.minPlayers) {
          ctx.log.info({ oyuncu: hepsi.length }, 'karıştırma atlandı: yeterli oyuncu yok');
          return;
        }

        const dagitilacak = config.keepSquadLeaders ? hepsi.filter((p) => !p.isLeader) : hepsi;

        let hedef = 1;
        let degisen = 0;
        for (const p of karistir(dagitilacak)) {
          if (kapali) return;
          const k = kimlik(p);
          if (k && p.teamId !== hedef) {
            await ctx.rcon.switchTeam(k);
            degisen++;
            if (config.commandDelayMs > 0) {
              await new Promise((r) => setTimeout(r, config.commandDelayMs));
            }
          }
          hedef = hedef === 1 ? 2 : 1;
        }

        if (config.announceMessage) await ctx.rcon.broadcast(config.announceMessage);
        ctx.log.info({ degisen, toplam: dagitilacak.length }, 'takımlar karıştırıldı');
      } finally {
        calisiyor = false;
      }
    }

    return {
      async onEvent(event) {
        if (event.type !== 'CHAT_MESSAGE') return;

        const komut = komutAyristir(event, config.prefix);
        if (!komut || !komutEslesti(komut.ad, config.command)) return;
        if (!config.channels.includes(komut.channel)) return;

        // Kanal yetki DEĞİLDİR: admin sohbetini görebilen herkes yetkili
        // olmayabilir. Eski plugin'in tek kontrolü buydu.
        if (!ctx.gercekAdminMi(komut.steamId, null)) {
          ctx.log.warn({ steamId: komut.steamId }, 'yetkisiz karıştırma denemesi reddedildi');
          return;
        }

        await karistirVeDagit();
      },

      onDisable() {
        kapali = true;
      },
    };
  },
} satisfies Plugin<Config>);
