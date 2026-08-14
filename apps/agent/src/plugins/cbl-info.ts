import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { tanimla } from '../plugin-host.js';

/**
 * Community Ban List'te kötü sicilli oyuncu bağlanınca adminleri uyarır.
 *
 * CBL, Squad topluluğunun ortak ban listesi. Yüksek itibar puanı "bu kişi
 * başka sunucularda sorun çıkarmış" demek.
 *
 * OTOMATİK YAPTIRIM YOK ve olmamalı. Eski plugin de yalnızca Discord'a bir
 * kart basıyordu; kimseyi atmıyor, banlamıyordu. Başka bir topluluğun
 * kararına dayanarak kendi sunucumuzdan oyuncu atmak, o kararı hiç
 * incelemeden devralmak olurdu. Bu olay bir UYARI, hüküm değil.
 *
 * Plugin Discord'u BİLMİYOR (plan Bölüm 6): olay üretiliyor, bot render
 * ediyor. Bot henüz yokken de iş görüyor — api olayı alınca oyuncuya
 * panelde görünen bir etiket koyuyor.
 */

const Config = z.object({
  /** Bu puan ve üstü uyarı üretir. CBL'in kendi ölçeği. */
  threshold: z.number().min(0).max(1000).default(6),
  /** Bağlanma ile sorgu arasındaki gecikme (saniye). */
  delaySeconds: z.number().int().min(0).max(120).default(5),
  /** CBL GraphQL ucu. */
  endpoint: z.string().url().default('https://communitybanlist.com/graphql'),
  /** İstek zaman aşımı. */
  timeoutSeconds: z.number().int().min(1).max(60).default(10),
});

type Config = z.infer<typeof Config>;

const SORGU = `query Search($id: String!) {
  steamUser(id: $id) {
    id
    name
    avatarFull
    reputationPoints
    riskRating
    reputationRank
    activeBans: bans(orderBy: "created", orderDirection: DESC, expired: false) { edges { node { id } } }
    expiredBans: bans(orderBy: "created", orderDirection: DESC, expired: true) { edges { node { id } } }
  }
}`;

interface CblKullanici {
  name?: string;
  avatarFull?: string;
  reputationPoints?: number;
  riskRating?: number;
  reputationRank?: number;
  activeBans?: { edges?: unknown[] };
  expiredBans?: { edges?: unknown[] };
}

export const cblInfo: ReturnType<typeof tanimla> = tanimla({
  name: 'cbl-info',
  description: "Community Ban List'te kötü sicilli oyuncu bağlanınca uyarı üretir.",
  configSchema: Config,

  create(ctx, config: Config) {
    let kapali = false;
    const bekleyen = new Set<string>();

    /**
     * CBL'e sorar. Kayıt yoksa ya da istek başarısızsa `null`.
     *
     * "Kayıt yok" ile "ulaşılamadı" burada aynı sonuca çıkıyor (uyarı
     * üretme) ama sebepleri ayrı loglanıyor: CBL kesintisi sessizce
     * "kimsenin sicili yok" gibi görünmemeli.
     */
    async function cblSor(steamId: string): Promise<CblKullanici | null> {
      const kontrol = new AbortController();
      const zamanlayici = setTimeout(() => kontrol.abort(), config.timeoutSeconds * 1000);
      try {
        const res = await fetch(config.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ query: SORGU, variables: { id: steamId } }),
          signal: kontrol.signal,
        });
        if (!res.ok) {
          ctx.log.warn({ steamId, durum: res.status }, 'CBL isteği başarısız');
          return null;
        }
        const govde = (await res.json()) as { data?: { steamUser?: CblKullanici | null } };
        const kullanici = govde.data?.steamUser;
        if (!kullanici) {
          // Listede olmamak İYİ haber; sessizce geçiliyor.
          return null;
        }
        return kullanici;
      } catch (err) {
        ctx.log.warn({ err, steamId }, 'CBL sorgusu yapılamadı');
        return null;
      } finally {
        clearTimeout(zamanlayici);
      }
    }

    async function isle(steamId: string, eosId: string | null, ad: string) {
      if (bekleyen.has(steamId)) return;
      bekleyen.add(steamId);
      try {
        if (config.delaySeconds > 0) {
          await new Promise((r) => setTimeout(r, config.delaySeconds * 1000));
          if (kapali) return;
        }

        const kullanici = await cblSor(steamId);
        if (!kullanici) return;

        const puan = kullanici.reputationPoints;
        if (typeof puan !== 'number' || puan < config.threshold) return;

        ctx.emit({
          type: 'CBL_ALERT',
          serverSlug: ctx.serverSlug,
          playerName: kullanici.name ?? ad,
          steamId,
          ...(eosId ? { eosId } : {}),
          reputationPoints: puan,
          ...(typeof kullanici.riskRating === 'number' ? { riskRating: kullanici.riskRating } : {}),
          ...(typeof kullanici.reputationRank === 'number'
            ? { reputationRank: kullanici.reputationRank }
            : {}),
          activeBans: kullanici.activeBans?.edges?.length ?? 0,
          expiredBans: kullanici.expiredBans?.edges?.length ?? 0,
          ...(kullanici.avatarFull ? { avatarUrl: kullanici.avatarFull } : {}),
          timestamp: new Date().toISOString(),
        });

        ctx.log.info({ oyuncu: ad, steamId, puan }, 'CBL uyarısı üretildi');
      } finally {
        bekleyen.delete(steamId);
      }
    }

    return {
      async onEvent(event) {
        if (event.type !== 'PLAYER_CONNECTED') return;
        // CBL yalnızca SteamID ile sorgulanabiliyor.
        if (!event.steamId) return;
        await isle(event.steamId, event.eosId ?? null, event.name);
      },

      onDisable() {
        kapali = true;
      },
    };
  },
} satisfies Plugin<Config>);
