import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { komutAyristir, komutEslesti } from '../chat-command.js';
import { tanimla } from '../plugin-host.js';

/**
 * Oyun içi kural gösterimi (`!kurallar`, `!kural 3`).
 *
 * Kural metinleri panelden yönetiliyor ve bu plugin'in ayarında KOPYASI
 * tutulmuyor. Eski sistemde kurallar hem Discord'da hem plugin config'inde
 * duruyordu; biri güncellenince diğeri unutuluyor ve oyuncuya söylenen
 * kural, yetkilinin uyguladığı kuraldan farklı olabiliyordu.
 *
 * İKİ KOMUT var çünkü iki ayrı soru soruluyor:
 *  - `!kurallar` -> "kurallar neler" (başlık listesi, kısa)
 *  - `!kural 3`  -> "3. kural tam olarak ne diyor" (tam metin)
 * Tek komutta tüm metinleri basmak, Squad'ın uyarı kutusunda okunamayan
 * bir duvar üretirdi.
 */

const Config = z.object({
  listCommand: z.string().trim().min(1).max(32).default('kurallar'),
  detailCommand: z.string().trim().min(1).max(32).default('kural'),
  prefix: z.string().trim().min(1).max(3).default('!'),
  channels: z
    .array(z.enum(['All', 'Team', 'Squad', 'Admin']))
    .min(1)
    .default(['All', 'Team', 'Squad']),
  /** Aynı oyuncu kaç saniyede bir sorabilir. */
  cooldownSeconds: z.number().int().min(0).max(600).default(15),
  /** Listede en fazla kaç başlık gösterilir. */
  maxListed: z.number().int().min(1).max(30).default(12),
});

type Config = z.infer<typeof Config>;

/**
 * Uzun metni Squad'ın uyarı kutusuna sığacak parçalara böler.
 *
 * Kelime sınırından bölüyor: karakter sayısına göre kesmek kelimeleri
 * ortadan ikiye ayırıyor ve kural metni okunamaz hâle geliyordu.
 */
export function parcala(metin: string, sinir = 180): string[] {
  const temiz = metin.trim().replace(/\s+/g, ' ');
  if (temiz.length <= sinir) return temiz ? [temiz] : [];

  const parcalar: string[] = [];
  let mevcut = '';
  for (const kelime of temiz.split(' ')) {
    // Tek başına sınırdan uzun bir kelime varsa (bağlantı gibi) kendi
    // parçasına konuyor; bölmek onu kullanılamaz yapardı.
    if (kelime.length > sinir) {
      if (mevcut) parcalar.push(mevcut);
      parcalar.push(kelime);
      mevcut = '';
      continue;
    }
    if (mevcut.length + kelime.length + 1 > sinir) {
      parcalar.push(mevcut);
      mevcut = kelime;
    } else {
      mevcut = mevcut ? `${mevcut} ${kelime}` : kelime;
    }
  }
  if (mevcut) parcalar.push(mevcut);
  return parcalar;
}

export const rules: ReturnType<typeof tanimla> = tanimla({
  name: 'rules',
  description: 'Oyun içi !kurallar ve !kural <n> komutları.',
  configSchema: Config,

  create(ctx, config: Config) {
    const sonSorgu = new Map<string, number>();

    return {
      async onEvent(event) {
        if (event.type !== 'CHAT_MESSAGE') return;

        const komut = komutAyristir(event, config.prefix);
        if (!komut) return;
        if (!config.channels.includes(komut.channel)) return;

        const liste = komutEslesti(komut.ad, config.listCommand);
        const detay = komutEslesti(komut.ad, config.detailCommand);
        if (!liste && !detay) return;

        if (config.cooldownSeconds > 0) {
          const son = sonSorgu.get(komut.steamId);
          if (son !== undefined) {
            const kalan = Math.ceil((config.cooldownSeconds * 1000 - (Date.now() - son)) / 1000);
            if (kalan > 0) {
              await ctx.rcon.warn(komut.steamId, `Biraz yavaş — ${kalan} sn sonra tekrar dene.`);
              return;
            }
          }
        }
        sonSorgu.set(komut.steamId, Date.now());

        const kurallar = await ctx.sunucuKurallari();

        // null = api'ye ulaşılamadı. "Kural yok" demek, oyuncuya kuralsız
        // bir sunucuda olduğunu söylemek olurdu.
        if (kurallar === null) {
          await ctx.rcon.warn(komut.steamId, 'Kurallar şu an alınamıyor, birazdan tekrar dene.');
          ctx.log.warn({ steamId: komut.steamId }, 'kural sorgusu cevapsız');
          return;
        }
        if (kurallar.length === 0) {
          await ctx.rcon.warn(komut.steamId, 'Bu sunucu için tanımlı kural yok.');
          return;
        }

        if (liste) {
          await ctx.rcon.warn(komut.steamId, `Kurallar (${config.detailCommand} <no> ile detay):`);
          let no = 1;
          for (const k of kurallar.slice(0, config.maxListed)) {
            await ctx.rcon.warn(komut.steamId, `${no}. ${k.title}`);
            no++;
          }
          if (kurallar.length > config.maxListed) {
            // Kesildiğini SÖYLEMEK şart: sessizce kırpılan bir liste,
            // oyuncuya görmediği kuralların olmadığını düşündürür.
            await ctx.rcon.warn(
              komut.steamId,
              `... ve ${kurallar.length - config.maxListed} kural daha.`,
            );
          }
          return;
        }

        // Detay: numara sıra numarası DEĞİL, listedeki sıra. Oyuncu
        // gördüğü listeye göre soruyor ve veritabanındaki `position`
        // değerlerinin araları boş olabiliyor.
        const no = Number.parseInt(komut.arguman.trim(), 10);
        if (!Number.isInteger(no) || no < 1 || no > kurallar.length) {
          await ctx.rcon.warn(
            komut.steamId,
            `Geçersiz numara. 1 ile ${kurallar.length} arası bir sayı yaz.`,
          );
          return;
        }

        const kural = kurallar[no - 1];
        if (!kural) return;
        await ctx.rcon.warn(komut.steamId, `${no}. ${kural.title}`);
        for (const parca of parcala(kural.body)) {
          await ctx.rcon.warn(komut.steamId, parca);
        }
      },
    };
  },
} satisfies Plugin<Config>);
