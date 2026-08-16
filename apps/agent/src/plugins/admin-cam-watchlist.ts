import type { Plugin, SquadJSOnlinePlayer } from '@altai/squad';
import { z } from 'zod';
import { komutAyristir, komutEslesti } from '../chat-command.js';
import { tanimla } from '../plugin-host.js';

/**
 * Admin kameraya geçince, sunucuda izlenen oyuncu var mı gösterir.
 *
 * Admin kameraya "birini izlemek için" geçiyor ama kimi izleyeceğini
 * bilmiyorsa kamera işe yaramıyor. Bu plugin geçiş anında listeyi ekrana
 * basıyor.
 *
 * KAYNAK DEĞİŞTİ: eski plugin BattleMetrics flag'lerini okuyordu ve her
 * oyuncu için ayrı bir BM isteği atıyordu — bu yüzden içinde bir istek
 * kuyruğu, eşzamanlılık sınırı, önbellek ve zaman aşımı vardı (619 satırın
 * çoğu bu). Etiketler artık bizim veritabanımızda ve tek sorguyla
 * geliyor; o makinenin tamamına gerek kalmadı.
 *
 * `!takip` komutu listeyi yeniden gönderiyor — kamerada bir süre kalan
 * admin listeyi kaçırdığında baştan bakabilsin diye.
 */

const Config = z.object({
  /** Bu adlardaki etiketler "izlenecek" sayılır. Boş = tüm etiketler. */
  watchedFlagNames: z
    .array(z.string().trim().min(1))
    .max(20)
    .default(['Hile Şüphelisi', 'İzlenecek Oyuncu']),
  messageHeader: z.string().trim().min(1).max(120).default('DİKKAT! İzlenecek oyuncular:'),
  /** Hiç izlenecek oyuncu yoksa da bildirilsin mi. */
  notifyWhenEmpty: z.boolean().default(false),
  emptyMessage: z.string().trim().min(1).max(120).default('Şu an izlenecek oyuncu yok.'),
  /** Mesajda en fazla kaç oyuncu listelenir. */
  maxPlayersInMessage: z.number().int().min(1).max(30).default(15),
  /** Kameraya geçtikten kaç saniye sonra gönderilir. */
  warnDelaySeconds: z.number().int().min(0).max(60).default(3),
  /** Aynı admine iki bildirim arası en az kaç saniye. */
  adminCooldownSeconds: z.number().int().min(0).max(600).default(60),
  /** Listeyi yeniden isteyen komut. */
  command: z.string().trim().min(1).max(32).default('takip'),
  prefix: z.string().trim().min(1).max(3).default('!'),
  channels: z
    .array(z.enum(['All', 'Team', 'Squad', 'Admin']))
    .min(1)
    .default(['Admin']),
});

type Config = z.infer<typeof Config>;

function kimlik(p: SquadJSOnlinePlayer): string | null {
  return p.eosId ?? p.steamId ?? null;
}

export const adminCamWatchlist: ReturnType<typeof tanimla> = tanimla({
  name: 'admin-cam-watchlist',
  description: 'Admin kameraya geçince sunucudaki izlenen oyuncuları gösterir.',
  configSchema: Config,

  create(ctx, config: Config) {
    /** adminKimliği -> son bildirim zamanı. */
    const sonBildirim = new Map<string, number>();
    let kapali = false;

    /** İzlenen oyuncuların satırları. `null` = sorgu cevapsız. */
    async function listeyiHazirla(): Promise<string[] | null> {
      const oyuncular = await ctx.players();
      const kimlikler = oyuncular.map(kimlik).filter((k): k is string => k !== null);
      if (kimlikler.length === 0) return [];

      const etiketliler = await ctx.etiketliOyuncular(kimlikler, config.watchedFlagNames);
      if (etiketliler === null) return null;

      const adBul = (steamId: string | null, eosId: string | null) =>
        oyuncular.find(
          (p) =>
            (steamId && p.steamId === steamId) ||
            (eosId && p.eosId?.toLowerCase() === eosId.toLowerCase()),
        )?.name ?? '(bilinmeyen)';

      return etiketliler.map((e) => `${adBul(e.steamId, e.eosId)} — ${e.flags.join(', ')}`);
    }

    async function bildir(hedef: string, beklemeyiUygula: boolean) {
      if (beklemeyiUygula && config.adminCooldownSeconds > 0) {
        const son = sonBildirim.get(hedef);
        if (son !== undefined && Date.now() - son < config.adminCooldownSeconds * 1000) return;
      }

      const satirlar = await listeyiHazirla();
      if (satirlar === null) {
        // Sorgu cevapsız kaldı. Sessiz kalmak, admine "izlenecek kimse
        // yok" izlenimi verirdi — oysa bilmiyoruz.
        await ctx.rcon.warn(hedef, 'İzleme listesi alınamadı (bağlantı sorunu).');
        return;
      }

      sonBildirim.set(hedef, Date.now());

      if (satirlar.length === 0) {
        if (config.notifyWhenEmpty) await ctx.rcon.warn(hedef, config.emptyMessage);
        return;
      }

      const gosterilen = satirlar.slice(0, config.maxPlayersInMessage);
      const kalan = satirlar.length - gosterilen.length;
      const govde = [config.messageHeader, ...gosterilen];
      if (kalan > 0) govde.push(`+${kalan} kişi daha`);

      await ctx.rcon.warn(hedef, govde.join('\n'));
    }

    return {
      async onEvent(event) {
        if (event.type === 'ADMIN_ACTION' && event.action === 'cam_enter') {
          const hedef = event.eosId ?? event.steamId;
          // Kimliksiz kamera girişinde kime göndereceğimizi bilmiyoruz.
          if (!hedef) return;

          if (config.warnDelaySeconds > 0) {
            // Geçişin hemen ardından gönderilen uyarı, kameranın açılış
            // animasyonu sırasında kayboluyor.
            await new Promise((r) => setTimeout(r, config.warnDelaySeconds * 1000));
            if (kapali) return;
          }
          await bildir(hedef, true);
          return;
        }

        if (event.type !== 'CHAT_MESSAGE') return;

        const komut = komutAyristir(event, config.prefix);
        if (!komut || !komutEslesti(komut.ad, config.command)) return;
        if (!config.channels.includes(komut.channel)) return;

        // Liste moderasyon bilgisi: yetkisiz biri kimin izlendiğini
        // öğrenmemeli, yoksa izleme anlamını yitirir.
        if (!ctx.gercekAdminMi(komut.steamId, null)) return;

        // Komutla istendiğinde bekleme uygulanmıyor: admin listeyi
        // bilinçli olarak yeniden istiyor.
        await bildir(komut.steamId, false);
      },

      onDisable() {
        kapali = true;
      },
    };
  },
} satisfies Plugin<Config>);
