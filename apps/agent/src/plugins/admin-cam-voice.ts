import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { tanimla } from '../plugin-host.js';

/**
 * Yetkili kamerasında Discord ses zorunluluğu.
 *
 * Kural şu ihtiyaçtan doğdu: kameraya geçen yetkili gördüğünü anlık olarak
 * paylaşamıyorsa kameranın moderasyon değeri düşüyor. Şüpheli bir oyuncuyu
 * izleyen kişi telsizde olmalı ki karar birlikte verilsin ve aynı oyuncuyu
 * iki yetkili ayrı ayrı izlemesin.
 *
 * KAYNAK DEĞİŞTİ: eski plugin Discord'a kendisi bağlanıyordu ve ses
 * durumunu kendi istemcisinden okuyordu. Bizde plugin Discord'u bilmiyor
 * (plan Bölüm 6): ses durumunu bot veritabanına yazıyor, plugin api'ye
 * soruyor.
 *
 * ÜÇ AYRI "HAYIR" var ve üçü farklı davranıyor:
 *  - bilinmiyor  -> hiçbir şey yapılmıyor. Bot kapalı ya da senkron bayat
 *                   olabilir ve botun kapalı olması yetkilinin suçu değil.
 *                   Eski sistem bunu ayırmıyordu; Discord kesintisinde
 *                   herkes uyarı yiyordu.
 *  - bağı yok    -> ceza değil, yönlendirme. Kişi hesabını hiç bağlamamış
 *                   olabilir ve bunu bilmesinin tek yolu söylenmesi.
 *  - seste değil -> kural uygulanıyor: kademeli uyarı, sonra isteğe bağlı
 *                   kick.
 *
 * KİCK VARSAYILAN OLARAK KAPALI. Bir yetkiliyi sunucudan atmak ağır bir
 * yaptırım ve bu plugin'in yanlış pozitifi (bağ yok, senkron gecikti)
 * doğrudan yetkiliyi vurur. Açmak isteyen panelden açar.
 */

const Config = z.object({
  /** Kameraya geçtikten kaç saniye sonra ilk kontrol yapılır. */
  graceSeconds: z.number().int().min(5).max(600).default(60),
  /** Sonraki kontroller arası süre. */
  checkIntervalSeconds: z.number().int().min(10).max(600).default(60),
  /**
   * Kaç uyarıdan sonra kick uygulanır. `kickEnabled` kapalıyken yalnızca
   * uyarı sayısını sınırlar (o sayıya ulaşınca uyarmayı bırakır).
   */
  maxWarnings: z.number().int().min(1).max(20).default(3),
  /** Uyarılar bittiğinde sunucudan atılsın mı. */
  kickEnabled: z.boolean().default(false),
  kickReason: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('Yetkili kamerası için Discord ses kanalında bulunmak gerekiyor.'),
  warnMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('Yetkili kamerasındasın ama Discord ses kanalında değilsin. Lütfen telsize gir.'),
  unlinkedMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default("Discord hesabın bağlı değil. Discord'da /baglan komutuyla bağla."),
  /**
   * Ses bilgisi kaç saniyeden eskiyse bayat sayılır.
   *
   * Botun nabız aralığı 30 sn; iki katından biraz fazlası, tek kaçan bir
   * nabız yüzünden yetkilinin uyarı yememesi için.
   */
  voiceMaxAgeSeconds: z.number().int().min(30).max(3600).default(90),
  /**
   * Bu Admins.cfg gruplarındaki yetkililer muaf.
   *
   * Kıdemli yetkililer kamerayı denetim dışı amaçlarla da kullanıyor
   * (kayıt alma, harita inceleme) ve onları telsize zorlamak gereksiz.
   */
  exemptGroups: z.array(z.string().trim().min(1)).max(20).default([]),
});

type Config = z.infer<typeof Config>;

export const adminCamVoice: ReturnType<typeof tanimla> = tanimla({
  name: 'admin-cam-voice',
  description: 'Yetkili kamerasındayken Discord ses kanalında bulunmayı zorunlu kılar.',
  configSchema: Config,

  create(ctx, config: Config) {
    /**
     * Kamerada olanlar: kimlik -> verilen uyarı sayısı.
     *
     * Kamera girişi/çıkışı bu haritayla izleniyor. Zamanlayıcı TEK ve
     * periyodik; kişi başına ayrı zamanlayıcı kurmak, çıkışı kaçırıldığında
     * sahipsiz zamanlayıcı bırakırdı.
     */
    const kamerada = new Map<string, { uyari: number; girisZamani: number }>();

    /** Uyarı/kick için kullanılacak kimlik. */
    const kimlik = (event: {
      steamId?: string | null | undefined;
      eosId?: string | null | undefined;
    }) => event.eosId ?? event.steamId ?? null;

    async function denetle() {
      if (kamerada.size === 0) return;

      const simdi = Date.now();
      for (const [id, durum] of [...kamerada]) {
        // Hoşgörü süresi dolmadan dokunulmuyor: kameraya yeni geçen biri
        // telsiği açacak zamanı bulamadan uyarı almamalı.
        if (simdi - durum.girisZamani < config.graceSeconds * 1000) continue;

        const ses = await ctx.sesDurumu(id, id, config.voiceMaxAgeSeconds);

        // BİLİNMİYOR: api kopuk, bot kapalı ya da senkron bayat. Hiçbir
        // şey yapılmıyor — bilinmeyen bir durumu ihlal saymak, altyapı
        // arızasını yetkiliye fatura etmek olurdu.
        if (ses === null || !ses.bilinen) {
          ctx.log.warn({ id }, 'ses durumu bilinmiyor — denetim atlandı');
          continue;
        }

        if (ses.seste) {
          // Telsize girdiyse sayaç sıfırlanıyor: bir sonraki ihlalde
          // kaldığı yerden değil baştan sayılmalı.
          if (durum.uyari > 0) {
            durum.uyari = 0;
            ctx.log.info({ id, kanal: ses.kanal }, 'yetkili telsize girdi — sayaç sıfırlandı');
          }
          continue;
        }

        durum.uyari++;

        if (!ses.bagli) {
          // Bağı olmayan kişi kuralı ihlal etmiyor, kuralı uygulayamıyor.
          // Kick UYGULANMIYOR: hesabını bağlamamış olmak, telsizden kaçmakla
          // aynı şey değil.
          await ctx.rcon.warn(id, config.unlinkedMessage);
          if (durum.uyari >= config.maxWarnings) kamerada.delete(id);
          continue;
        }

        if (durum.uyari <= config.maxWarnings) {
          const kalan = config.maxWarnings - durum.uyari;
          const ek =
            config.kickEnabled && kalan > 0 ? ` (${kalan} uyarı sonra sunucudan atılacaksın)` : '';
          await ctx.rcon.warn(id, `${config.warnMessage}${ek}`);
          ctx.log.info({ id, uyari: durum.uyari }, 'ses uyarısı gönderildi');
        }

        if (durum.uyari >= config.maxWarnings) {
          if (config.kickEnabled) {
            await ctx.rcon.kick(id, config.kickReason);
            ctx.log.warn({ id }, 'yetkili ses kuralı nedeniyle atıldı');
          } else {
            ctx.log.info({ id }, 'uyarı sınırına ulaşıldı — kick kapalı, izleme bırakıldı');
          }
          // İki durumda da izleme bırakılıyor: kick edildiyse zaten
          // sunucuda değil, edilmediyse aynı kişiye sonsuza kadar uyarı
          // yağdırmanın kimseye faydası yok.
          kamerada.delete(id);
        }
      }
    }

    ctx.every(config.checkIntervalSeconds * 1000, denetle);

    return {
      async onEvent(event) {
        if (event.type !== 'ADMIN_ACTION') return;

        if (event.action === 'cam_enter') {
          const id = kimlik(event);
          if (!id) return;

          // Muafiyet giriş anında bir kez bakılıyor: her denetimde tekrar
          // sormanın karşılığı yok, grup üyeliği maç ortasında değişmiyor.
          if (config.exemptGroups.length > 0) {
            const grup = ctx.adminGrubu(event.steamId, event.eosId);
            if (grup && config.exemptGroups.includes(grup)) {
              ctx.log.info({ id, grup }, 'ses denetiminden muaf');
              return;
            }
          }

          kamerada.set(id, { uyari: 0, girisZamani: Date.now() });
          return;
        }

        if (event.action === 'cam_exit') {
          const id = kimlik(event);
          if (id) kamerada.delete(id);
        }
      },

      onDisable() {
        // Plugin kapatılırken izleme listesi de gitmeli: yeniden açıldığında
        // kimsenin "hâlâ kamerada" sanılmaması gerekiyor. Kamera durumunu
        // RCON'dan okumanın bir yolu yok, tek kaynak olay akışı.
        kamerada.clear();
      },
    };
  },
} satisfies Plugin<Config>);
