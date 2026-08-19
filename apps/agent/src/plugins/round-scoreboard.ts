import type { AgentEvent, RoundPlayerStat } from '@altai/contracts';
import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { tanimla } from '../plugin-host.js';

/**
 * Maç sonunda ilk N oyuncuyu sunucuya duyurur.
 *
 * VERİYİ SORGULAMIYOR: skorbord zaten `ROUND_ENDED` olayının içinde
 * geliyor (Faz 4, parti 1). Yani bu plugin api'ye hiç gitmiyor ve api
 * kopukken bile çalışıyor — maç sonu duyurusu, en çok ihtiyaç duyulan anda
 * bir ağ bağlantısına bağlı olmamalı.
 *
 * Duyuru GECİKMELİ gönderiliyor. Maç bittiği an ekranda sonuç tablosu
 * açılıyor ve o sırada giden broadcast kimsenin görmediği bir yere düşüyor;
 * eski sistemde tam olarak bu yüzden "duyuru çalışmıyor" sanılıyordu.
 */

const Config = z.object({
  /** Kaç oyuncu duyurulacak. */
  top: z.number().int().min(1).max(10).default(3),
  /**
   * Maç bittikten kaç saniye sonra duyurulacak.
   *
   * 0 yapılabilir ama önerilmez: sonuç ekranı açıkken giden mesaj
   * görülmüyor.
   */
  delaySeconds: z.number().int().min(0).max(120).default(12),
  /** Sıralama ölçütü. */
  metric: z.enum(['kills', 'revives', 'kdr']).default('kills'),
  /**
   * Duyuru için gereken en az oyuncu sayısı.
   *
   * Üç kişilik bir seed maçında "maçın en iyisi" duyurmak, duyuruyu
   * anlamsızlaştırıyordu.
   */
  minPlayers: z.number().int().min(0).max(100).default(10),
  header: z.string().trim().min(1).max(120).default('Maçın en iyileri:'),
});

type Config = z.infer<typeof Config>;

/**
 * Skorbordu ölçüte göre sıralayıp ilk N'i döndürür.
 *
 * Saf ve dışa açık: "kimse öldürme yapmamışsa listeye kim girer" sorusunun
 * cevabı bir Squad sunucusu gerektirmemeli.
 *
 * Sıfır değerli oyuncular ELENİYOR. Hiç öldürme yapmamış birini "maçın en
 * iyisi" diye duyurmak, listeyi doldurmak uğruna duyuruyu gülünç ederdi.
 */
export function enIyiler(
  players: RoundPlayerStat[],
  metric: Config['metric'],
  top: number,
): RoundPlayerStat[] {
  const deger = (p: RoundPlayerStat) =>
    metric === 'kills'
      ? p.kills
      : metric === 'revives'
        ? p.revives
        : // K/D'de ölüm sıfırsa bölme yapılmıyor; kdOrani ile aynı kural.
          p.deaths > 0
          ? p.kills / p.deaths
          : p.kills;

  return players
    .filter((p) => deger(p) > 0)
    .sort((a, b) => {
      const fark = deger(b) - deger(a);
      if (fark !== 0) return fark;
      // Eşitlikte isme göre: aynı maç iki kez işlense aynı sıra çıksın.
      return (a.name ?? '').localeCompare(b.name ?? '');
    })
    .slice(0, top);
}

/** Bir satırın duyuruda görünecek metni. */
export function satirMetni(p: RoundPlayerStat, metric: Config['metric'], sira: number): string {
  const ad = p.name?.trim() || '(bilinmeyen)';
  if (metric === 'kills') return `${sira}. ${ad} — ${p.kills} öldürme`;
  if (metric === 'revives') return `${sira}. ${ad} — ${p.revives} canlandırma`;
  const kdr = p.deaths > 0 ? Math.round((p.kills / p.deaths) * 100) / 100 : p.kills;
  return `${sira}. ${ad} — K/D ${kdr} (${p.kills}/${p.deaths})`;
}

export const roundScoreboard: ReturnType<typeof tanimla> = tanimla({
  name: 'round-scoreboard',
  description: 'Maç sonunda ilk N oyuncuyu sunucuya duyurur.',
  configSchema: Config,

  create(ctx, config: Config) {
    return {
      async onEvent(event: AgentEvent) {
        if (event.type !== 'ROUND_ENDED') return;

        // Skorbord yoksa duyuru da yok: agent maç ortasında başlamış
        // olabilir. Uydurma bir liste göstermek, olmayan bir maçı
        // duyurmak olurdu.
        const players = event.players;
        if (!players || players.length === 0) return;

        if (players.length < config.minPlayers) {
          ctx.log.info(
            { oyuncu: players.length, esik: config.minPlayers },
            'maç sonu duyurusu atlandı — oyuncu sayısı eşiğin altında',
          );
          return;
        }

        const liste = enIyiler(players, config.metric, config.top);
        if (liste.length === 0) return;

        // Zamanlayıcı host'a ait (plan Bölüm 6): plugin kapatılırsa
        // bekleyen duyuru da iptal olur, kapalı bir plugin konuşmaz.
        ctx.sonra(config.delaySeconds * 1000, async () => {
          await ctx.rcon.broadcast(config.header);
          let sira = 1;
          for (const p of liste) {
            await ctx.rcon.broadcast(satirMetni(p, config.metric, sira));
            sira++;
          }
          ctx.log.info({ kisi: liste.length }, 'maç sonu skorbordu duyuruldu');
        });
      },
    };
  },
} satisfies Plugin<Config>);
