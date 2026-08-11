import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { tanimla } from '../plugin-host.js';

/**
 * Sunucuya bağlanan oyuncuya, oturum başına bir kez, gecikmeli hoş geldin
 * mesajı gönderir.
 *
 * Gecikme şart: oyuncu bağlandığı anda hâlâ yükleme ekranında ve o sırada
 * gönderilen warn hiç görünmüyor. Eski plugin'in varsayılanı 20 saniyeydi,
 * korundu.
 *
 * Oyuncu süre dolmadan çıkarsa mesaj İPTAL ediliyor: aksi hâlde bir sonraki
 * girişinde, bambaşka bir bağlamda gecikmiş bir "hoş geldin" alıyordu.
 */

const Config = z.object({
  delaySeconds: z.number().int().min(0).max(300).default(20),
  message: z
    .string()
    .trim()
    .min(1)
    .max(250)
    .default('Hoş geldin! Bizi tercih ettiğin için teşekkürler, iyi oyunlar.'),
});

type Config = z.infer<typeof Config>;

export const welcomeWarn: ReturnType<typeof tanimla> = tanimla({
  name: 'welcome-warn',
  description: 'Bağlanan oyuncuya gecikmeli hoş geldin mesajı gönderir.',
  configSchema: Config,

  create(ctx, config: Config) {
    // Tek seferlik ve oyuncuya bağlı zamanlayıcılar. `ctx.every` periyodik
    // işler için; bunlar onDisable'da elle temizleniyor.
    const bekleyen = new Map<string, ReturnType<typeof setTimeout>>();

    const iptal = (id: string | null | undefined) => {
      if (!id) return;
      const t = bekleyen.get(id);
      if (t) {
        clearTimeout(t);
        bekleyen.delete(id);
      }
    };

    return {
      onEvent(event) {
        if (event.type === 'PLAYER_CONNECTED') {
          // EOS tercih ediliyor: Squad admin komutlarında daha güvenilir.
          const id = event.eosId ?? event.steamId;
          if (!id) return;
          iptal(id);
          const t = setTimeout(() => {
            bekleyen.delete(id);
            void ctx.rcon.warn(id, config.message).catch((err) => {
              ctx.log.warn({ err, oyuncu: event.name }, 'hoş geldin mesajı gönderilemedi');
            });
          }, config.delaySeconds * 1000);
          bekleyen.set(id, t);
          return;
        }

        if (event.type === 'PLAYER_DISCONNECTED') {
          // Çıkış olayı yalnızca steamId taşıyor. Bağlanışta EOS ile
          // kaydettiysek bu iptal tutmaz; o durumda mesaj gider ama
          // oyuncu sunucuda olmadığı için RCON zararsızca yutar.
          iptal(event.steamId);
        }
      },

      onDisable() {
        for (const t of bekleyen.values()) clearTimeout(t);
        bekleyen.clear();
      },
    };
  },
} satisfies Plugin<Config>);
