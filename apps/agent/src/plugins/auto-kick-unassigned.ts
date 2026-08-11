import type { SquadJSOnlinePlayer } from '@altai/squad';
import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { tanimla } from '../plugin-host.js';

/**
 * Manga'ya (squad) girmeyen oyuncuları uyarır, ısrar ederse atar.
 *
 * Amaç ceza değil yer açmak: sunucu doluyken manga dışında bekleyen oyuncu,
 * oynamak isteyen birinin yerini tutuyor. Bu yüzden sunucu doluluğu eşiğin
 * altındayken kimse atılmıyor.
 *
 * Tasarım notları:
 *  - Sayaç OYUNCU BAŞINA tutuluyor ve manga'ya girince sıfırlanıyor.
 *  - Kimlik olarak EOS tercih ediliyor (Squad artık oyuncuyu onunla tanıyor),
 *    yoksa SteamID. İkisi de yoksa oyuncu atlanıyor: kimliksiz birini
 *    atmaya çalışmak yanlış kişiyi atma riski taşır.
 *  - Manga LİDERLERİ hiçbir zaman atılmaz (zaten manga'dalar) — kontrol
 *    squadId üzerinden, liderlik ayrı bir durum değil.
 *  - Uyarı ve atma sayısı `ctx.emit` ile yukarı bildirilmiyor; bu plugin
 *    sessiz çalışıyor. Bildirim gerekirse bot tarafında ADMIN_ACTION
 *    olaylarından zaten görünüyor (RCON kick'i SquadJS yayıyor).
 */

const Config = z.object({
  /** Kaç saniyede bir kontrol edilir. */
  checkIntervalSeconds: z.number().int().min(10).max(600).default(60),
  /** Oyuncu kaç kontrol boyunca mangasız kalırsa atılır. */
  kickAfterChecks: z.number().int().min(1).max(20).default(5),
  /** Bu sayıda oyuncudan az varken kimse atılmaz. */
  minPlayersToKick: z.number().int().min(0).max(100).default(50),
  warningMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('Manga (squad) kur ya da bir mangaya katıl, yoksa atılacaksın.'),
  kickReason: z.string().trim().min(1).max(200).default('Mangasız kaldın'),
});

type Config = z.infer<typeof Config>;

/** EOS tercih edilir; Squad admin komutlarında daha güvenilir. */
function kimlik(p: SquadJSOnlinePlayer): string | null {
  if (p.eosId && /^[0-9a-f]{32}$/i.test(p.eosId)) return p.eosId;
  if (p.steamId && /^7656119\d{10}$/.test(p.steamId)) return p.steamId;
  return null;
}

export const autoKickUnassigned: ReturnType<typeof tanimla> = tanimla({
  name: 'auto-kick-unassigned',
  description: 'Mangasız oyuncuları uyarır, ısrar ederse sunucu doluyken atar.',
  configSchema: Config,

  create(ctx, config: Config) {
    /** kimlik -> üst üste kaç kontrolde mangasız görüldü. */
    const sayac = new Map<string, number>();

    ctx.every(config.checkIntervalSeconds * 1000, async () => {
      // Önbellek 10 saniyede bir yenileniyor; bir önceki turda attığımız
      // oyuncunun listede kalması sayacı yanlış ilerletirdi.
      await ctx.refreshPlayers();
      const oyuncular = await ctx.players();

      const mangasiz = oyuncular.filter((p) => p.squadId === null);
      // Mangaya girenlerin sayacı düşsün: aksi hâlde bir kez mangasız
      // görülen oyuncu, sonradan mangaya girse bile eski sayacıyla atılırdı.
      const mangasizKimlikler = new Set(mangasiz.map(kimlik).filter(Boolean) as string[]);
      for (const k of [...sayac.keys()]) {
        if (!mangasizKimlikler.has(k)) sayac.delete(k);
      }

      const atmaAcik = oyuncular.length >= config.minPlayersToKick;

      for (const p of mangasiz) {
        const k = kimlik(p);
        if (!k) continue;

        const sayi = (sayac.get(k) ?? 0) + 1;
        sayac.set(k, sayi);

        if (sayi >= config.kickAfterChecks && atmaAcik) {
          await ctx.rcon.kick(k, config.kickReason);
          sayac.delete(k);
          ctx.log.info({ oyuncu: p.name, kontrol: sayi }, 'mangasız oyuncu atıldı');
          continue;
        }

        // Sunucu boşken de uyarı gidiyor ama atma yok: oyuncu dolmadan
        // önce mangaya girsin, dolduğunda atılmak zorunda kalmasın.
        await ctx.rcon.warn(k, config.warningMessage);
      }
    });

    return {
      onEvent(event) {
        // Oyuncu mangaya GİRDİĞİ anda sayacı düşür.
        //
        // Periyodik tarama bunu zaten yapıyor ama bir tur gecikmeyle:
        // oyuncu mangaya girdikten sonra bile bir sonraki turda hâlâ eski
        // sayacıyla görünüyordu ve son uyarıdaki "atılacaksın" mesajını
        // boşuna alıyordu. Anında düşürmek o gürültüyü kaldırıyor.
        if (event.type !== 'PLAYER_STATE_CHANGE') return;
        if (event.change !== 'squad') return;
        if (event.squadId === null || event.squadId === undefined) return;

        const k = event.eosId ?? event.steamId;
        if (k) sayac.delete(k);
      },
    };
  },
} satisfies Plugin<Config>);
