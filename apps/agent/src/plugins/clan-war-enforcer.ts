import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { tanimla } from '../plugin-host.js';

/**
 * Klan savaşı yaptırımı — plan Faz 5.
 *
 * Klan savaşı gecesi sunucu herkese açık kalmamalı: iki klan anlaşıp saat
 * ayırıyor, araya giren üçüncü kişiler maçı bozuyor.
 *
 * KAYNAK DEĞİŞTİ. Eski `clanwarenforcer` izinli oyuncu listesini plugin'in
 * config dosyasında tutuyordu; her maç öncesi dosyayı elle düzenleyip
 * agent'ı yeniden başlatmak gerekiyordu ve maç ortasında birini eklemek
 * imkânsızdı. Liste artık panelde ve plugin sorguyla okuyor.
 *
 * YAPTIRIM SADECE `live` SAVAŞTA. Savaş yoksa, henüz lobide ise ya da
 * bittiyse plugin hiçbir şey yapmıyor — ve bu ayrım cevapta AYRI bir
 * alanda taşınıyor (`aktif`), çünkü boş kadro ile "savaş yok" karıştığında
 * sunucudaki HERKES atılırdı.
 */

const Config = z.object({
  /** Kadro kaç saniyede bir kontrol edilecek. */
  checkIntervalSeconds: z.number().int().min(10).max(600).default(30),
  /**
   * Oyuncuya atılmadan önce kaç saniye tanınacak.
   *
   * Sıfır değil: sunucuya yanlışlıkla giren biri uyarıyı okuyup kendi
   * çıkabilmeli. Anında atmak, "ne oldu" bile diyemeden kapı dışarı
   * edilmek demek.
   */
  graceSeconds: z.number().int().min(0).max(300).default(45),
  warnMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('Bu sunucuda klan savaşı var. Kadroda değilsen birazdan çıkarılacaksın.'),
  kickReason: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('Klan savaşı — yalnızca kadrodaki oyuncular girebilir.'),
  /**
   * Yetkililer muaf mı.
   *
   * Varsayılan AÇIK: maçı yöneten yetkilinin sunucuda olması gerekiyor ve
   * onu kadroya yazmak, kadroyu oyuncu listesi olmaktan çıkarırdı.
   */
  exemptAdmins: z.boolean().default(true),
});

type Config = z.infer<typeof Config>;

/**
 * Oyuncu kadroda mı?
 *
 * İki kimlik de kontrol ediliyor: Squad oyuncuyu EOS ile tanıyor ama
 * kadro SteamID ile giriliyor. Yalnızca birine bakmak, kimliklerinden
 * biri eksik olan oyuncuları haksız yere atardı.
 *
 * Saf ve dışa açık: "kimin atılacağı" kararı bir Squad sunucusu olmadan
 * test edilebilmeli — yanlışı doğrudan insanları sunucudan atıyor.
 */
export function kadrodaMi(
  oyuncu: { steamId?: string | null; eosId?: string | null },
  kadro: { steamIds: string[]; eosIds: string[] },
): boolean {
  if (oyuncu.steamId && kadro.steamIds.includes(oyuncu.steamId)) return true;
  if (oyuncu.eosId && kadro.eosIds.includes(oyuncu.eosId.toLowerCase())) return true;
  return false;
}

export const clanWarEnforcer: ReturnType<typeof tanimla> = tanimla({
  name: 'clan-war-enforcer',
  description: 'Klan savaşı sırasında sunucuyu kadrodaki oyunculara kapatır.',
  configSchema: Config,

  create(ctx, config: Config) {
    /** kimlik -> ilk uyarıldığı an. Hoşgörü süresi buradan sayılıyor. */
    const uyarilanlar = new Map<string, number>();

    async function denetle() {
      const kadro = await ctx.klanSavasiKadrosu();

      // BİLİNMİYOR (api kopuk): hiçbir şey yapılmıyor. Bir bağlantı
      // kesintisi yüzünden maçtaki oyuncuları atmak, yaptırımın önlemeye
      // çalıştığı şeyin ta kendisi olurdu.
      if (kadro === null) {
        ctx.log.warn({}, 'klan savaşı kadrosu alınamadı — yaptırım atlandı');
        return;
      }

      // Savaş yok: liste temizlenip çıkılıyor. Temizlik şart, yoksa bir
      // sonraki savaşta eski uyarı zamanları hoşgörü süresini yemiş olurdu.
      if (!kadro.aktif) {
        if (uyarilanlar.size > 0) uyarilanlar.clear();
        return;
      }

      // Kadro boş olamaz: api `live` savaşı boş kadroyla başlatmıyor
      // (bkz. durumDegistir). Yine de kontrol ediliyor — bu koşulun
      // yanlış olması sunucuyu boşaltmak demek.
      if (kadro.steamIds.length === 0 && kadro.eosIds.length === 0) {
        ctx.log.error({ warId: kadro.warId }, 'klan savaşı kadrosu BOŞ — yaptırım uygulanmadı');
        return;
      }

      const simdi = Date.now();
      const oyuncular = await ctx.players();

      for (const oyuncu of oyuncular) {
        const kimlik = oyuncu.eosId ?? oyuncu.steamId;
        if (!kimlik) continue;

        if (kadrodaMi(oyuncu, kadro)) {
          uyarilanlar.delete(kimlik);
          continue;
        }
        if (config.exemptAdmins && ctx.gercekAdminMi(oyuncu.steamId, oyuncu.eosId)) {
          continue;
        }

        const ilkUyari = uyarilanlar.get(kimlik);
        if (ilkUyari === undefined) {
          uyarilanlar.set(kimlik, simdi);
          await ctx.rcon.warn(kimlik, config.warnMessage);
          ctx.log.info({ oyuncu: oyuncu.name }, 'kadro dışı oyuncu uyarıldı');
          continue;
        }

        if (simdi - ilkUyari >= config.graceSeconds * 1000) {
          await ctx.rcon.kick(kimlik, config.kickReason);
          uyarilanlar.delete(kimlik);
          ctx.log.warn({ oyuncu: oyuncu.name }, 'kadro dışı oyuncu atıldı');
        }
      }

      // Sunucudan kendi çıkanlar listeden düşüyor: Map sonsuza kadar
      // büyümemeli ve geri gelen biri hoşgörüyü baştan hak ediyor.
      const mevcut = new Set(oyuncular.map((p) => p.eosId ?? p.steamId).filter(Boolean));
      for (const kimlik of [...uyarilanlar.keys()]) {
        if (!mevcut.has(kimlik)) uyarilanlar.delete(kimlik);
      }
    }

    ctx.every(config.checkIntervalSeconds * 1000, denetle);

    return {
      onDisable() {
        uyarilanlar.clear();
      },
    };
  },
} satisfies Plugin<Config>);
