import type { Plugin, SquadJSOnlinePlayer } from '@altai/squad';
import { z } from 'zod';
import { tanimla } from '../plugin-host.js';

/**
 * Seçkin komutan sahaya çıkınca duyurur ve manga liderlerini uyarır.
 *
 * Amaç: komutanlık yapmayı bilen bir oyuncu göreve geldiğinde takımın onu
 * dinlemesi. Duyuru olmadan çoğu manga lideri komutanın kim olduğunu
 * fark etmiyordu.
 *
 * LİSTE ARTIK AYRI BİR TABLO DEĞİL. Eski plugin `EliteCommander`
 * koleksiyonunu tutuyor ve 60 saniyede bir yeniden okuyordu. Bizde bu bir
 * ETİKET (`flags`) — panelden yönetiliyor, tarihçesi tutuluyor ve oyuncu
 * profilinde rozet olarak görünüyor. Aynı iş için ikinci bir liste
 * mekanizması kurmak, ikisinin zamanla ayrışması demekti.
 *
 * SORGU YÖNÜ TERSİNE ÇEVRİLDİ. Eski plugin önce listeyi yükleyip o
 * kişileri izliyordu; yani liste büyüdükçe her turda daha çok iş. Burada
 * önce komutan DEĞİŞİMİ yakalanıyor (yerel ve bedava), sonra "bu kişi
 * seçkin mi" diye BİR sorgu atılıyor. Komutan değişimi nadir bir olay
 * olduğu için sorgu sayısı listeden bağımsız.
 */

const Config = z.object({
  /** Seçkin komutanları işaretleyen etiket adı. */
  flagName: z.string().trim().min(1).max(64).default('Elite Commander'),
  /** Komutan mangasının adı (Squad'ın sabiti). */
  commandSquadName: z.string().trim().min(1).max(64).default('Command Squad'),
  /** Kaç saniyede bir komutan durumu kontrol edilir. */
  checkIntervalSeconds: z.number().int().min(10).max(300).default(30),
  broadcastMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('{playerName} komutan oldu — komutanı dinlemek zorunludur.'),
  /** Aynı takımdaki manga liderlerine ayrıca uyarı gitsin mi. */
  warnSquadLeaders: z.boolean().default(true),
  warnMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('Seçkin komutan {playerName} göreve geldi. Komutanı dinlemek zorunludur!'),
});

type Config = z.infer<typeof Config>;

function anahtar(p: SquadJSOnlinePlayer): string | null {
  return p.eosId ?? p.steamId ?? null;
}

function hedefKimlik(p: SquadJSOnlinePlayer): string | null {
  return p.eosId ?? p.steamId ?? null;
}

export const eliteCommander: ReturnType<typeof tanimla> = tanimla({
  name: 'elite-commander',
  description: 'Seçkin komutan göreve geldiğinde duyurur ve manga liderlerini uyarır.',
  configSchema: Config,

  create(ctx, config: Config) {
    const aranan = config.flagName.toLocaleUpperCase('tr-TR');
    const komutanMangasi = config.commandSquadName.toLocaleLowerCase('tr-TR');

    /** kimlik -> son turda komutan mıydı. */
    const oncekiDurum = new Map<string, boolean>();
    /** Aynı kişi için üst üste sorgu açılmasın. */
    const sorulan = new Set<string>();

    const komutanMi = (p: SquadJSOnlinePlayer) =>
      p.isLeader && (p.squadName ?? '').toLocaleLowerCase('tr-TR') === komutanMangasi;

    async function seckinMi(p: SquadJSOnlinePlayer): Promise<boolean> {
      const cevap = await ctx.oyuncuEtiketleri(p.steamId, p.eosId);
      if (cevap === null) {
        // Bilmiyoruz. Duyuru YAPILMIYOR: olmayan bir unvanı ilan etmek,
        // eksik bir duyurudan daha kötü.
        ctx.log.warn({ oyuncu: p.name }, 'etiket sorgusu cevapsız — komutan duyurusu atlandı');
        return false;
      }
      return cevap.flags.some((f) => f.toLocaleUpperCase('tr-TR') === aranan);
    }

    async function duyur(komutan: SquadJSOnlinePlayer, oyuncular: SquadJSOnlinePlayer[]) {
      await ctx.rcon.broadcast(config.broadcastMessage.replace('{playerName}', komutan.name));

      if (!config.warnSquadLeaders) return;

      const mesaj = config.warnMessage.replace('{playerName}', komutan.name);
      const komutanAnahtari = anahtar(komutan);

      for (const p of oyuncular) {
        if (!p.isLeader) continue;
        if (p.teamId !== komutan.teamId) continue;
        // Komutanın kendisi ve komutan mangasındakiler hariç: onlar zaten
        // durumun içinde ve kendi kendine uyarı göndermek anlamsız.
        if (anahtar(p) === komutanAnahtari) continue;
        if ((p.squadName ?? '').toLocaleLowerCase('tr-TR') === komutanMangasi) continue;

        const hedef = hedefKimlik(p);
        if (hedef) await ctx.rcon.warn(hedef, mesaj);
      }
    }

    async function tara() {
      const oyuncular = await ctx.players();
      const cevrimici = new Set<string>();

      for (const p of oyuncular) {
        const k = anahtar(p);
        if (!k) continue;
        cevrimici.add(k);

        const simdi = komutanMi(p);
        const onceki = oncekiDurum.get(k) ?? false;
        oncekiDurum.set(k, simdi);

        // Yalnızca GEÇİŞ ilgilendiriyor: komutan olarak kalmaya devam
        // etmek her turda yeniden duyurulacak bir şey değil.
        if (onceki || !simdi) continue;
        if (sorulan.has(k)) continue;

        sorulan.add(k);
        try {
          if (await seckinMi(p)) {
            await duyur(p, oyuncular);
            ctx.log.info({ oyuncu: p.name, takim: p.teamId }, 'seçkin komutan duyuruldu');
          }
        } finally {
          sorulan.delete(k);
        }
      }

      // Sunucudan çıkanların durumu unutuluyor: geri geldiğinde komutan
      // olursa yeniden duyurulmalı.
      for (const k of [...oncekiDurum.keys()]) {
        if (!cevrimici.has(k)) oncekiDurum.delete(k);
      }
    }

    ctx.every(config.checkIntervalSeconds * 1000, tara);

    return {
      onEvent(event) {
        // Yeni maçta komutanlık sıfırlanıyor; aynı kişi tekrar komutan
        // olursa duyuru yeniden yapılmalı.
        if (event.type === 'ROUND_STARTED') oncekiDurum.clear();
      },
    };
  },
} satisfies Plugin<Config>);
