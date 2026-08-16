import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { komutAyristir, komutEslesti } from '../chat-command.js';
import { tanimla } from '../plugin-host.js';

/**
 * Hangi manga önce kuruldu? (`!claim 3 5`)
 *
 * Squad'da aynı rolü (zırhlı, helikopter, keskin nişancı) iki manga birden
 * isteyince tartışma çıkıyor ve "ben önce kurdum" iddiası doğrulanamıyordu.
 * Bu komut mangaların kuruluş sırasını gösteriyor.
 *
 * VERİ KALICI DEĞİL ve olmamalı: iddia yalnızca o maç içinde anlamlı.
 * Round bitince liste sıfırlanıyor. Eski plugin de böyleydi; veritabanına
 * yazmak, bir daha kimsenin bakmayacağı satırlar biriktirmekten başka işe
 * yaramazdı.
 *
 * Eski plugin'de her cevap İKİ KEZ ve 5 saniye arayla gönderiliyordu
 * ("görünürlüğü artırmak için"). Bu korunmadı: Squad'ın uyarı kutusu zaten
 * mesajı ekranda tutuyor ve tekrar, oyuncunun ekranını gereksiz yere iki
 * kat uzun kaplıyordu. Tek fark bu; sıralama mantığı birebir aynı.
 */

const Config = z.object({
  command: z.string().trim().min(1).max(32).default('claim'),
  prefix: z.string().trim().min(1).max(3).default('!'),
  /** Yalnızca manga liderleri kullanabilsin mi. */
  onlySquadLeader: z.boolean().default(false),
  /** Adminler için bekleme (saniye). */
  adminCooldownSeconds: z.number().int().min(0).max(300).default(3),
  /** Oyuncular için bekleme (saniye). */
  playerCooldownSeconds: z.number().int().min(0).max(300).default(5),
  /** Tek uyarıda en fazla kaç satır gösterilir. */
  linesPerWarn: z.number().int().min(1).max(10).default(5),
});

type Config = z.infer<typeof Config>;

interface MangaKaydi {
  squadId: number;
  squadName: string;
  teamId: number;
  kurulusMs: number;
}

function saatBicimi(ms: number): string {
  const t = new Date(ms);
  const iki = (n: number) => String(n).padStart(2, '0');
  return `${iki(t.getHours())}:${iki(t.getMinutes())}:${iki(t.getSeconds())}`;
}

export const squadClaim: ReturnType<typeof tanimla> = tanimla({
  name: 'squad-claim',
  description: 'Mangaların kuruluş sırasını gösterir (!claim 3 5).',
  configSchema: Config,

  create(ctx, config: Config) {
    /** takım -> manga numarası -> kayıt. */
    const mangalar = new Map<number, Map<number, MangaKaydi>>();
    /** steamId -> son kullanım. */
    const sonKullanim = new Map<string, number>();

    const takim = (teamId: number) => {
      let m = mangalar.get(teamId);
      if (!m) {
        m = new Map();
        mangalar.set(teamId, m);
      }
      return m;
    };

    async function satirlariGonder(steamId: string, satirlar: string[]) {
      for (let i = 0; i < satirlar.length; i += config.linesPerWarn) {
        const parca = satirlar.slice(i, i + config.linesPerWarn);
        await ctx.rcon.warn(steamId, parca.join('\n'));
      }
    }

    return {
      async onEvent(event) {
        if (event.type === 'ROUND_ENDED' || event.type === 'ROUND_STARTED') {
          // İddia yalnızca o maç içinde geçerli.
          mangalar.clear();
          sonKullanim.clear();
          return;
        }

        if (event.type === 'SQUAD_CREATED') {
          // `teamId` olmadan kayıt tutulamaz: aynı numaralı manga her iki
          // takımda da var ve karıştırmak yanlış mangayı gösterirdi.
          if (event.teamId === null || event.teamId === undefined) return;
          const no = Number.parseInt(event.squadId, 10);
          if (!Number.isInteger(no)) return;

          takim(event.teamId).set(no, {
            squadId: no,
            squadName: event.squadName,
            teamId: event.teamId,
            kurulusMs: new Date(event.timestamp).getTime(),
          });
          return;
        }

        if (event.type !== 'CHAT_MESSAGE') return;

        const komut = komutAyristir(event, config.prefix);
        if (!komut || !komutEslesti(komut.ad, config.command)) return;

        const yetkili = ctx.gercekAdminMi(komut.steamId, null);

        // Bekleme süresi yetkiye göre: admin bir tartışmayı çözerken
        // arka arkaya birkaç mangaya bakmak zorunda kalabiliyor.
        const bekleme =
          (yetkili ? config.adminCooldownSeconds : config.playerCooldownSeconds) * 1000;
        const son = sonKullanim.get(komut.steamId);
        if (bekleme > 0 && son !== undefined && Date.now() - son < bekleme) {
          const kalan = Math.ceil((bekleme - (Date.now() - son)) / 1000);
          await ctx.rcon.warn(komut.steamId, `${kalan} saniye bekle.`);
          return;
        }

        const oyuncular = await ctx.players();
        const soran = oyuncular.find((p) => p.steamId === komut.steamId);
        if (!soran || soran.teamId === null) {
          await ctx.rcon.warn(komut.steamId, 'Oyuncu bilgin okunamadı, birazdan tekrar dene.');
          return;
        }

        if (config.onlySquadLeader && !soran.isLeader && !yetkili) {
          await ctx.rcon.warn(komut.steamId, 'Bu komutu sadece manga liderleri kullanabilir.');
          return;
        }

        const numaralar = [
          ...new Set(
            komut.arguman
              .split(/[\s,]+/)
              .map((n) => Number.parseInt(n, 10))
              .filter((n) => Number.isInteger(n) && n > 0),
          ),
        ];

        if (numaralar.length < 2) {
          await ctx.rcon.warn(
            komut.steamId,
            `En az iki manga numarası gir. Örnek: ${config.prefix}${config.command} 3 5`,
          );
          return;
        }

        sonKullanim.set(komut.steamId, Date.now());

        const kendiTakimi = takim(soran.teamId);
        const bulunan: MangaKaydi[] = [];
        const eksik: number[] = [];
        for (const no of numaralar) {
          const kayit = kendiTakimi.get(no);
          // Dağılmış mangalar listede kalabiliyor; hâlâ var mı diye
          // canlı listeye bakılıyor.
          const halaVar = oyuncular.some((p) => p.teamId === soran.teamId && p.squadId === no);
          if (kayit && halaVar) bulunan.push(kayit);
          else eksik.push(no);
        }

        if (bulunan.length < 2) {
          await ctx.rcon.warn(komut.steamId, 'En az iki geçerli manga numarası gerekiyor.');
          return;
        }

        bulunan.sort((a, b) => a.kurulusMs - b.kurulusMs);
        const satirlar = bulunan.map(
          (m, i) =>
            `${i + 1}. Manga ${m.squadId} [${m.squadName.slice(0, 10)}] — ${saatBicimi(m.kurulusMs)}`,
        );
        if (eksik.length > 0) satirlar.push(`Bulunamadı: ${eksik.join(', ')}`);

        await satirlariGonder(komut.steamId, satirlar);
      },
    };
  },
} satisfies Plugin<Config>);
