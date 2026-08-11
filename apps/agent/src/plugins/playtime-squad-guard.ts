import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { tanimla } from '../plugin-host.js';

/**
 * Yeterli Squad saati olmayan oyuncuların manga kurmasını engeller.
 *
 * Manga kurmak sunucunun akışını belirleyen bir eylem; deneyimsiz bir lider
 * 40 kişinin maçını bozabiliyor. Saat Steam Web API'sinden okunuyor.
 *
 * "Acemi SL" istisnası korundu: adında belirli kalıpları taşıyan mangalar
 * daha düşük eşiğe tabi — yeni oyuncuların öğrenebileceği bir yol kalsın.
 *
 * STEAM ANAHTARI PLUGIN AYARINDA DEĞİL, agent'ın .env'inde. Ayarlar
 * panelden okunabiliyor ve denetim kaydına öncesi/sonrasıyla yazılıyor;
 * bir API anahtarının oraya düşmesi onu sızdırmak olurdu.
 *
 * GİZLİ PROFİL: Steam profili kapalıysa saat okunamıyor. Varsayılan
 * davranış uyarmak ama ENGELLEMEMEK — profilini kapalı tutmak kural ihlali
 * değil ve herkesi cezalandırmak orantısız.
 */

const STEAM_APP_ID = 393380;

const Config = z.object({
  /** Normal manga kurmak için gereken saat. */
  minHours: z.number().int().min(0).max(10_000).default(100),
  /** "Acemi" mangalar için daha düşük eşik. */
  rookieEnabled: z.boolean().default(false),
  rookieMinHours: z.number().int().min(0).max(10_000).default(80),
  rookieNamePatterns: z.array(z.string().trim().min(1)).default(['acemi sl', 'acemisl']),
  /** Steam yanıtları kaç dakika önbellekte tutulur. */
  cacheMinutes: z.number().int().min(1).max(1440).default(60),
  warnMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('Manga kurmak için en az {minHours} saat gerekiyor. Senin saatin: {hours}.'),
  privateProfileMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('Steam oyun detayların gizli. Manga kurmak için profilini açıp tekrar dene.'),
  /** Profil gizliyse manga dağıtılsın mı. */
  blockOnPrivateProfile: z.boolean().default(false),
  /** Gerçek admin yetkisi olanlar muaf. */
  exemptAdmins: z.boolean().default(true),
  /** Kontrolden muaf SteamID'ler. */
  whitelistedSteamIds: z.array(z.string().trim()).default([]),
});

type Config = z.infer<typeof Config>;

interface SaatSonucu {
  hours: number | null;
  isPrivate: boolean;
  fetchedAt: number;
}

export const playtimeSquadGuard: ReturnType<typeof tanimla> = tanimla({
  name: 'playtime-squad-guard',
  description: 'Yeterli Squad saati olmayanların manga kurmasını engeller.',
  configSchema: Config,

  create(ctx, config: Config) {
    const anahtar = ctx.secrets.steamApiKey;
    if (!anahtar) {
      // Sessizce çalışmayan bir koruma, olmayan bir korumadan kötü.
      ctx.log.error({}, 'STEAM_API_KEY tanımlı değil — saat kontrolü yapılamayacak');
    }

    const onbellek = new Map<string, SaatSonucu>();
    const muaf = new Set(config.whitelistedSteamIds);
    const acemiKaliplari = config.rookieNamePatterns.map((p) =>
      p.toLowerCase().replace(/\s+/g, ''),
    );

    function acemiMangaMi(squadName: string): boolean {
      if (!config.rookieEnabled) return false;
      const ad = squadName.toLowerCase().replace(/\s+/g, '');
      return acemiKaliplari.some((k) => ad.includes(k));
    }

    /** Steam'den saat okur. Hata durumunda null döner — çağıran ENGELLEMEZ. */
    async function saatOku(steamId: string): Promise<SaatSonucu | null> {
      if (!anahtar) return null;

      const onbellekli = onbellek.get(steamId);
      if (onbellekli && Date.now() - onbellekli.fetchedAt < config.cacheMinutes * 60_000) {
        return onbellekli;
      }

      try {
        const ozetUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${anahtar}&steamids=${steamId}`;
        const oyunUrl = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${anahtar}&steamid=${steamId}&include_appinfo=0&include_played_free_games=1&appids_filter[0]=${STEAM_APP_ID}`;

        const [ozetRes, oyunRes] = await Promise.all([fetch(ozetUrl), fetch(oyunUrl)]);
        if (!ozetRes.ok || !oyunRes.ok) return null;

        const ozet = (await ozetRes.json()) as {
          response?: { players?: Array<{ communityvisibilitystate?: number }> };
        };
        const oyunlar = (await oyunRes.json()) as {
          response?: { games?: Array<{ appid: number; playtime_forever?: number }> };
        };

        // 3 = herkese açık. Diğer her şey (1 gizli, 2 sadece arkadaşlar) kapalı.
        const gorunurluk = ozet.response?.players?.[0]?.communityvisibilitystate;
        const liste = oyunlar.response?.games;
        const oyunGizli = !Array.isArray(liste) || liste.length === 0;

        let hours: number | null = null;
        let saatGizli = false;
        if (!oyunGizli) {
          const squad = liste.find((g) => g.appid === STEAM_APP_ID);
          hours = squad ? Math.round((squad.playtime_forever ?? 0) / 60) : 0;
          // Oyun listede var ama saat 0: oyuncu saatini gizlemiş. Sunucuda
          // manga kurabildiğine göre oyunu gerçekten oynuyor.
          if (squad && hours === 0) saatGizli = true;
        }

        const sonuc: SaatSonucu = {
          hours,
          isPrivate: gorunurluk !== 3 || oyunGizli || saatGizli,
          fetchedAt: Date.now(),
        };
        onbellek.set(steamId, sonuc);
        return sonuc;
      } catch (err) {
        // Steam'e ulaşılamıyorsa kimse cezalandırılmıyor: dış servis
        // kesintisi yüzünden oyuncuların mangası dağıtılmamalı.
        ctx.log.warn({ err, steamId }, 'Steam API okunamadı — kontrol atlandı');
        return null;
      }
    }

    function mesaj(sablon: string, saat: number | null, esik: number): string {
      return sablon.replace('{minHours}', String(esik)).replace('{hours}', String(saat ?? '-'));
    }

    return {
      async onEvent(event) {
        if (event.type !== 'SQUAD_CREATED') return;
        if (!event.steamId) return; // saat yalnızca SteamID ile sorulabiliyor
        if (muaf.has(event.steamId)) return;
        if (config.exemptAdmins && ctx.gercekAdminMi(event.steamId, event.eosId)) return;

        const hedef = event.eosId ?? event.steamId;
        const acemi = acemiMangaMi(event.squadName);
        const esik = acemi ? config.rookieMinHours : config.minHours;

        const sonuc = await saatOku(event.steamId);
        if (!sonuc) return; // okunamadı — engelleme yok

        // Manga dağıtmak için sayısal takım kimliği şart. Bu alan
        // SQUAD_CREATED'e bu iş için eklendi; yoksa yalnızca uyarabiliriz.
        const dagitabilir = typeof event.teamId === 'number';
        const squadId = Number(event.squadId);

        if (sonuc.isPrivate) {
          await ctx.rcon.warn(hedef, config.privateProfileMessage);
          if (config.blockOnPrivateProfile && dagitabilir && Number.isInteger(squadId)) {
            await ctx.rcon.disbandSquad(event.teamId as number, squadId);
          }
          return;
        }

        if (sonuc.hours !== null && sonuc.hours < esik) {
          await ctx.rcon.warn(hedef, mesaj(config.warnMessage, sonuc.hours, esik));
          if (dagitabilir && Number.isInteger(squadId)) {
            await ctx.rcon.disbandSquad(event.teamId as number, squadId);
            ctx.log.info(
              { oyuncu: event.playerName, saat: sonuc.hours, esik, acemi },
              'yetersiz saat — manga dağıtıldı',
            );
          } else {
            // Takım kimliği gelmediyse dağıtamıyoruz. Sessizce geçmek
            // "engellendi" sanılmasına yol açar.
            ctx.log.warn(
              { oyuncu: event.playerName },
              'takım kimliği yok — manga dağıtılamadı, yalnızca uyarıldı',
            );
          }
        }
      },
    };
  },
} satisfies Plugin<Config>);
