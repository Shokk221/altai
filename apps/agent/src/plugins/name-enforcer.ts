import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { tanimla } from '../plugin-host.js';

/**
 * İsminde Kiril (Rusça) veya CJK (Çince/Japonca) karakter bulunan oyuncuları
 * atar.
 *
 * Eşik yok: tek karakter yeterli. Eski plugin'in davranışı buydu ve
 * korunuyor — "%50'den fazlası Kiril olsun" gibi bir oran, karışık isimlerde
 * tutarsız sonuç veriyordu.
 *
 * SEED/TRAINING haritalarında atma yapılmıyor: sunucu boşken oyuncu atmak,
 * doldurmaya çalıştığın sunucuyu boşaltmak demek.
 *
 * Adminler muaf tutulabiliyor (`exemptAdmins`). Muafiyet, api'den itilen
 * oyun içi yetki listesine bakıyor — vendored SquadJS'in `server.admins`'i
 * boş bir stub olduğu için o kaynak kullanılamıyor.
 */

const Config = z.object({
  kickMessage: z
    .string()
    .trim()
    .min(1)
    .max(250)
    .default(
      'Isminizde Rusca veya Cince karakter kullanamazsiniz. Lutfen degistirip tekrar gelin.',
    ),
  /** Muaf SteamID'ler. */
  exemptSteamIds: z.array(z.string().trim()).default([]),
  /** Muaf EOS ID'ler. */
  exemptEosIds: z.array(z.string().trim()).default([]),
  /** Seed/training haritalarında atma yapılmasın. */
  ignoreSeedLayers: z.boolean().default(true),
  /**
   * Gerçek admin yetkisi olanlar muaf.
   *
   * Yalnızca `reserve` yetkisi olan (bağışçı / klan whitelist'i) muaf
   * DEĞİL — eski plugin de bu ayrımı yapıyordu ve karıştırmak "bağışçı
   * olduğu için kicklenmedi" demek olurdu.
   */
  exemptAdmins: z.boolean().default(true),
});

type Config = z.infer<typeof Config>;

/**
 * Yasaklı karakter aralıkları — eski plugin'den birebir taşındı:
 *   U+0400–U+04FF  Kiril
 *   U+0500–U+052F  Kiril ek
 *   U+2DE0–U+2DFF  Kiril genişletilmiş A
 *   U+A640–U+A69F  Kiril genişletilmiş B
 *   U+3400–U+4DBF  CJK genişletilmiş A
 *   U+4E00–U+9FFF  CJK temel
 *   U+F900–U+FAFF  CJK uyumluluk
 */
const YASAKLI = /[Ѐ-ԯⷠ-ⷿꙀ-ꚟ㐀-䶿一-鿿豈-﫿]/;

/** Seed/eğitim haritası mı — layer adından çıkarılıyor. */
function seedLayerMi(layer: string | undefined): boolean {
  if (!layer) return false;
  const l = layer.toLowerCase();
  return l.includes('seed') || l.includes('tutorial') || l.includes('jensen');
}

export const nameEnforcer: ReturnType<typeof tanimla> = tanimla({
  name: 'name-enforcer',
  description: 'İsminde Kiril veya CJK karakter olan oyuncuları atar.',
  configSchema: Config,

  create(ctx, config: Config) {
    const muafSteam = new Set(config.exemptSteamIds);
    const muafEos = new Set(config.exemptEosIds);

    return {
      async onEvent(event) {
        if (event.type !== 'PLAYER_CONNECTED') return;
        // En ucuz kontrol en başta: oyuncuların büyük çoğunluğu buradan döner.
        if (!YASAKLI.test(event.name)) return;

        if (muafSteam.has(event.steamId)) return;
        if (event.eosId && muafEos.has(event.eosId)) return;

        // Yetki listesi api'den geliyor; henüz gelmediyse kimse admin
        // sayılmıyor ve muafiyet uygulanmıyor. Bilmediğimiz bir yetkiyi
        // varmış gibi saymak, yasaklı isimli oyuncuyu serbest bırakırdı.
        if (config.exemptAdmins && ctx.gercekAdminMi(event.steamId, event.eosId)) {
          ctx.log.info({ oyuncu: event.name }, 'admin muaf — atma atlandı');
          return;
        }

        if (config.ignoreSeedLayers) {
          const durum = await ctx.status();
          if (seedLayerMi(durum.currentLayer)) {
            ctx.log.info(
              { oyuncu: event.name, layer: durum.currentLayer },
              'seed haritası — atma atlandı',
            );
            return;
          }
        }

        const id = event.eosId ?? event.steamId;
        await ctx.rcon.kick(id, config.kickMessage);
        ctx.log.info({ oyuncu: event.name, id }, 'yasaklı karakter — oyuncu atıldı');
      },
    };
  },
} satisfies Plugin<Config>);
