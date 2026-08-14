import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { komutAyristir, komutEslesti } from '../chat-command.js';
import { tanimla } from '../plugin-host.js';

/**
 * Sis savaşını admin komutuyla açıp kapatır (`!fow`).
 *
 * OTOMATİK AÇILMAZ. Eski plugin'in de en belirgin kararı buydu: sunucu
 * hangi ayarla başladıysa öyle kalır, yalnızca bir admin komut verirse
 * değişir. Sis savaşını maç ortasında kendiliğinden açmak, oyunun
 * dengesini kimsenin istemediği bir anda değiştirmek olurdu.
 *
 * Yetki GRUP düzeyinde. `kick` yetkisi olan her adminin haritayı
 * karartabilmesi istenmiyor; eski plugin de `allowedGroups` ile
 * SuperAdmin/HeadAdmin'e sınırlıyordu.
 *
 * Yeni maçta iç durum sıfırlanıyor ama RCON komutu GÖNDERİLMİYOR: sunucu
 * sis savaşını maç başında zaten kendi varsayılanına döndürüyor. Buradaki
 * tek amaç bir sonraki `!fow`'un doğru yönde çalışması.
 */

const Config = z.object({
  command: z.string().trim().min(1).max(32).default('fow'),
  prefix: z.string().trim().min(1).max(3).default('!'),
  /** Komutun kabul edileceği kanallar. */
  channels: z
    .array(z.enum(['All', 'Team', 'Squad', 'Admin']))
    .min(1)
    .default(['Admin']),
  /** Komutu kullanabilecek Admins.cfg grupları. */
  allowedGroups: z.array(z.string().trim().min(1)).min(1).default(['SuperAdmin', 'HeadAdmin']),
  onMessage: z.string().trim().min(1).max(200).default('Sis savaşı açıldı!'),
  offMessage: z.string().trim().min(1).max(200).default('Sis savaşı kapatıldı!'),
});

type Config = z.infer<typeof Config>;

export const fogOfWar: ReturnType<typeof tanimla> = tanimla({
  name: 'fog-of-war',
  description: 'Yetkili adminlerin !fow komutuyla sis savaşını açıp kapatmasını sağlar.',
  configSchema: Config,

  create(ctx, config: Config) {
    const izinli = new Set(config.allowedGroups.map((g) => g.toLocaleLowerCase('tr-TR')));

    /** Yalnızca toggle yönünü hatırlamak için — sunucunun gerçek durumu değil. */
    let acik = false;
    /** İki admin aynı anda yazarsa ikincisi reddedilir. */
    let islemde = false;

    return {
      async onEvent(event) {
        if (event.type === 'ROUND_STARTED') {
          // Sunucu sis savaşını sıfırladı; yön takibimiz de sıfırlanmalı.
          // RCON'a komut GÖNDERİLMİYOR (bkz. dosya başı).
          acik = false;
          return;
        }

        if (event.type !== 'CHAT_MESSAGE') return;

        const komut = komutAyristir(event, config.prefix);
        if (!komut || !komutEslesti(komut.ad, config.command)) return;
        if (!config.channels.includes(komut.channel)) return;

        const grup = ctx.adminGrubu(komut.steamId, null);
        if (!grup || !izinli.has(grup.toLocaleLowerCase('tr-TR'))) {
          // Yetki listesi henüz gelmediyse de burası çalışıyor ve komut
          // reddediliyor: bilmediğimiz bir yetkiyi varmış gibi saymaktansa
          // ağır bir komutu engellemek doğru taraf.
          await ctx.rcon.warn(komut.steamId, 'Bu komutu kullanma yetkin yok.');
          ctx.log.warn({ steamId: komut.steamId, grup }, 'yetkisiz !fow denemesi');
          return;
        }

        if (islemde) {
          await ctx.rcon.warn(komut.steamId, 'Komut zaten işleniyor, birazdan tekrar dene.');
          return;
        }
        islemde = true;

        try {
          const hedef = acik ? 0 : 1;
          await ctx.rcon.setFogOfWar(hedef);
          acik = !acik;
          await ctx.rcon.broadcast(acik ? config.onMessage : config.offMessage);
          ctx.log.info({ acik, grup, steamId: komut.steamId }, 'sis savaşı değiştirildi');
        } catch (err) {
          // Durum DEĞİŞTİRİLMİYOR: komut başarısızsa sunucu eski hâlinde
          // kaldı ve `acik` bayrağını çevirmek bir sonraki komutu ters
          // yönde çalıştırırdı.
          ctx.log.error({ err }, 'sis savaşı komutu başarısız');
          await ctx.rcon.warn(komut.steamId, 'Komut RCON hatası ile başarısız oldu.');
        } finally {
          islemde = false;
        }
      },
    };
  },
} satisfies Plugin<Config>);
