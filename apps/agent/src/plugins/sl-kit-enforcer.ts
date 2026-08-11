import type { Plugin, SquadJSOnlinePlayer } from '@altai/squad';
import { z } from 'zod';
import { tanimla } from '../plugin-host.js';

/**
 * Manga lideri olduğu hâlde SL kiti almayan oyuncuyu önce uyarır, ısrar
 * ederse MANGADAN ÇIKARIR — sunucudan atmaz.
 *
 * Ceza ayrımı önemli: kit almamak sunucudan atılmayı hak eden bir davranış
 * değil, yalnızca mangayı sahipsiz bırakan bir durum. Eski plugin de
 * `AdminRemovePlayerFromSquad` kullanıyordu, aynısı korundu.
 *
 * İki tetikleyici var:
 *  - `PLAYER_STATE_CHANGE` (rol değişimi) — anında tepki. Bu olay bu iş
 *    için `AgentEvent` sözleşmesine yeni eklendi.
 *  - periyodik tarama — olay kaçarsa ya da oyuncu hiç rol değiştirmeden
 *    lider olursa yakalar.
 *
 * Sunucu boşken devreye girmiyor: 12 kişilik bir sunucuda kit denetimi
 * yapmak, oynamaya çalışan insanları rahatsız etmekten başka işe yaramıyor.
 */

const Config = z.object({
  /** Geçerli SL kitlerini tanıyan kalıplar (regex, büyük/küçük harf duyarsız). */
  kitPatterns: z.array(z.string().trim().min(1)).min(1).default(['Leader', 'Officer', 'SL']),
  warningMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('Manga liderisin ama kitin yanlış. SL kitini al, yoksa mangandan çıkarılacaksın.'),
  removalMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('Manga lideri olmana rağmen SL kiti almadığın için mangandan çıkarıldın.'),
  /** Kaç saniyede bir kontrol edilir (uyarı da bu ritimde gider). */
  checkIntervalSeconds: z.number().int().min(10).max(300).default(30),
  /** Tespitten kaç saniye sonra mangadan çıkarılır. */
  removalAfterSeconds: z.number().int().min(30).max(900).default(120),
  /** Bu sayıdan az oyuncu varsa kural işlemez. */
  minPlayers: z.number().int().min(0).max(100).default(40),
});

type Config = z.infer<typeof Config>;

function kimlik(p: SquadJSOnlinePlayer): string | null {
  if (p.eosId && /^[0-9a-f]{32}$/i.test(p.eosId)) return p.eosId;
  if (p.steamId && /^7656119\d{10}$/.test(p.steamId)) return p.steamId;
  return null;
}

export const slKitEnforcer: ReturnType<typeof tanimla> = tanimla({
  name: 'sl-kit-enforcer',
  description: 'SL kiti almayan manga liderlerini uyarır, ısrar ederse mangadan çıkarır.',
  configSchema: Config,

  create(ctx, config: Config) {
    /** kimlik -> ilk tespit zamanı. */
    const takip = new Map<string, number>();
    const kalip = config.kitPatterns.map((p) => {
      try {
        return new RegExp(p, 'i');
      } catch {
        // Geçersiz regex ayarı plugin'i düşürmesin; düz metin araması yap.
        return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }
    });

    const kitGecerli = (role: string | null) =>
      Boolean(role) && kalip.some((r) => r.test(role as string));

    async function tara() {
      const oyuncular = await ctx.players();

      // Sunucu boşaldıysa takip sıfırlanıyor: dolduğunda kimse birikmiş
      // süreyle anında cezalandırılmasın.
      if (oyuncular.length < config.minPlayers) {
        takip.clear();
        return;
      }

      const simdi = Date.now();
      const gorulen = new Set<string>();

      for (const p of oyuncular) {
        const k = kimlik(p);
        if (!k) continue;

        // Lider değilse ya da kiti doğruysa takipten çıkar.
        if (!p.isLeader || p.squadId === null || kitGecerli(p.role)) {
          takip.delete(k);
          continue;
        }

        gorulen.add(k);
        const ilk = takip.get(k);
        if (ilk === undefined) {
          takip.set(k, simdi);
          await ctx.rcon.warn(k, `${config.warningMessage} (${config.removalAfterSeconds} sn)`);
          continue;
        }

        const gecen = (simdi - ilk) / 1000;
        if (gecen >= config.removalAfterSeconds) {
          await ctx.rcon.warn(k, config.removalMessage);
          await ctx.rcon.removeFromSquad(k);
          takip.delete(k);
          ctx.log.info({ oyuncu: p.name, saniye: Math.round(gecen) }, 'SL mangadan çıkarıldı');
        } else {
          const kalan = Math.ceil(config.removalAfterSeconds - gecen);
          await ctx.rcon.warn(k, `${config.warningMessage} (${kalan} sn)`);
        }
      }

      // Sunucudan çıkanların takibini bırak — yoksa harita boyunca birikir.
      for (const k of [...takip.keys()]) {
        if (!gorulen.has(k)) takip.delete(k);
      }
    }

    ctx.every(config.checkIntervalSeconds * 1000, tara);

    return {
      async onEvent(event) {
        // Rol değişiminde beklemeden bak: oyuncu SL olup yanlış kit aldıysa
        // bir sonraki tarama turunu beklemek 30 saniye kaybettirir.
        if (event.type !== 'PLAYER_STATE_CHANGE') return;
        if (event.change !== 'role' && event.change !== 'became_leader') return;
        if (!event.isLeader) return;
        if (kitGecerli(event.role ?? null)) {
          const k = event.eosId ?? event.steamId;
          if (k) takip.delete(k);
          return;
        }
        await tara();
      },
    };
  },
} satisfies Plugin<Config>);
