import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { tanimla } from '../plugin-host.js';

/**
 * Takım öldüren oyuncuyu uyarır; ALL chat'te özür dilemezse atar.
 *
 * Anlaşmalı TK istisnası korundu: kurban `!anlaşmalıtk` yazarak olayı
 * onaylıyor ve saldırgan cezalandırılmıyor. Bu, eski sistemde en çok
 * kullanılan kaçış yoluydu — klan içi eğitim ve şaka TK'leri yüzünden
 * insanlar haksızca atılıyordu.
 *
 * Round bitince BÜTÜN bekleyen TK borçları siliniyor: yeni round'da eski
 * bir TK için kimse atılmamalı, temiz sayfa.
 *
 * Seed/eğitim modunda hiç çalışmıyor — sunucu doldurulmaya çalışılırken
 * oyuncu atmak amaca ters.
 *
 * ANAHTAR SEÇİMİ: bekleyen özürler steamId ile anahtarlanıyor. Sohbet olayı
 * yalnızca steamId taşıyor; TK olayı ikisini de taşıdığı için uyarı/atma
 * EOS ile yapılıyor (Squad'ın admin komutlarında EOS daha güvenilir).
 */

const Config = z.object({
  attackerMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default("Takım arkadaşını öldürdün. Lütfen ALL chat'te özür dile."),
  /** Kaç saniyede bir hatırlatma uyarısı gider. */
  reminderIntervalSeconds: z.number().int().min(10).max(300).default(30),
  /** Özür gelmezse kaç saniye sonra atılır. */
  kickAfterSeconds: z.number().int().min(30).max(900).default(180),
  apologyKeywords: z
    .array(z.string().trim().min(1))
    .min(1)
    .default(['özür', 'özr', 'pardon', 'sorry', 'sry', 'kusura bakma', 'affedersin']),
  thankYouMessage: z.string().trim().min(1).max(200).default('Özür dilediğin için teşekkürler.'),
  kickMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default("Takım öldürmesi sonrası ALL chat'te özür dilemedin."),
  /** Anlaşmalı TK onayı açık mı. */
  consensualEnabled: z.boolean().default(true),
  consensualCommands: z.array(z.string().trim().min(1)).min(1).default(['!anlaşmalıtk']),
  consensualVictimMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default("Anlaşmalı bir TK ise ALL chat'e !anlaşmalıtk yazarak onaylayabilirsin."),
  consensualConfirmMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('Anlaşmalı TK onaylandı, işlem uygulanmayacak.'),
  /** Seed/eğitim modunda TK uyarısı verilmesin. */
  disableWhileSeeding: z.boolean().default(true),
  /** Bu sayıdan az oyuncu varsa sunucu seed sayılır. */
  seedingThreshold: z.number().int().min(0).max(100).default(60),
});

type Config = z.infer<typeof Config>;

interface Bekleyen {
  /** Uyarı ve atma bu kimliğe gidiyor (EOS varsa o). */
  hedefId: string;
  hatirlatici: ReturnType<typeof setInterval>;
  atmaZamanlayici: ReturnType<typeof setTimeout>;
  atmaAni: number;
}

function seedLayerMi(layer: string | undefined): boolean {
  if (!layer) return false;
  const l = layer.toLowerCase();
  return l.includes('seed') || l.includes('tutorial') || l.includes('jensen');
}

export const autoTkWarn: ReturnType<typeof tanimla> = tanimla({
  name: 'auto-tk-warn',
  description: "Takım öldüreni uyarır; ALL chat'te özür dilemezse atar (anlaşmalı TK hariç).",
  configSchema: Config,

  create(ctx, config: Config) {
    /** saldırganın steamId'si -> bekleyen ceza. */
    const bekleyenler = new Map<string, Bekleyen>();
    /** kurbanın steamId'si -> saldırganın steamId'si (anlaşmalı TK onayı için). */
    const sonKurbanlar = new Map<string, string>();
    let roundArasi = false;

    const anahtarlar = config.consensualCommands.map((c) => c.toLowerCase().trim());
    const kelimeler = config.apologyKeywords.map((k) => k.toLowerCase());

    function temizle(steamId: string) {
      const b = bekleyenler.get(steamId);
      if (!b) return;
      clearInterval(b.hatirlatici);
      clearTimeout(b.atmaZamanlayici);
      bekleyenler.delete(steamId);
    }

    function hepsiniTemizle() {
      for (const id of [...bekleyenler.keys()]) temizle(id);
      sonKurbanlar.clear();
    }

    return {
      async onEvent(event) {
        // ---------------------------------------------------------- round
        if (event.type === 'ROUND_ENDED') {
          // Round bitince temiz sayfa: yeni round'da eski TK için kimse
          // atılmamalı.
          const adet = bekleyenler.size;
          hepsiniTemizle();
          roundArasi = true;
          if (adet > 0) ctx.log.info({ adet }, 'round bitti — bekleyen TK cezaları iptal edildi');
          return;
        }
        if (event.type === 'ROUND_STARTED') {
          roundArasi = false;
          return;
        }

        // ------------------------------------------------------------ TK
        if (event.type === 'TEAMKILL') {
          if (roundArasi) return;
          const saldiranSteam = event.attackerSteamId;
          if (!saldiranSteam) return; // kimliksiz saldırgana ceza uygulanamaz

          if (config.disableWhileSeeding) {
            const durum = await ctx.status();
            if (durum.playerCount < config.seedingThreshold || seedLayerMi(durum.currentLayer)) {
              ctx.log.info(
                { oyuncu: event.attackerName, oyuncuSayisi: durum.playerCount },
                'seed/eğitim modu — TK uyarısı atlandı',
              );
              return;
            }
          }

          const hedef = event.attackerEosId ?? saldiranSteam;

          if (config.consensualEnabled && event.victimSteamId) {
            sonKurbanlar.set(event.victimSteamId, saldiranSteam);
            const kurbanHedef = event.victimEosId ?? event.victimSteamId;
            await ctx.rcon.warn(kurbanHedef, config.consensualVictimMessage);
          }

          // Aynı oyuncu tekrar TK yaptıysa eski sayaç yenisiyle değişiyor;
          // iki zamanlayıcı birden çalışsaydı iki kez uyarı giderdi.
          temizle(saldiranSteam);
          await ctx.rcon.warn(hedef, config.attackerMessage);

          const atmaAni = Date.now() + config.kickAfterSeconds * 1000;
          const hatirlatici = setInterval(() => {
            if (!bekleyenler.has(saldiranSteam)) return;
            const kalan = Math.max(0, Math.round((atmaAni - Date.now()) / 1000));
            void ctx.rcon
              .warn(hedef, `Özür dilemek için ${kalan} saniyen kaldı.`)
              .catch(() => undefined);
          }, config.reminderIntervalSeconds * 1000);

          const atmaZamanlayici = setTimeout(() => {
            if (!bekleyenler.has(saldiranSteam)) return;
            temizle(saldiranSteam);
            void ctx.rcon.kick(hedef, config.kickMessage).then(
              () => ctx.log.info({ oyuncu: event.attackerName }, 'TK — özür gelmedi, atıldı'),
              () => undefined,
            );
          }, config.kickAfterSeconds * 1000);

          bekleyenler.set(saldiranSteam, { hedefId: hedef, hatirlatici, atmaZamanlayici, atmaAni });
          return;
        }

        // --------------------------------------------------------- sohbet
        if (event.type !== 'CHAT_MESSAGE') return;
        // Admin kanalı hariç: özür herkesin göreceği bir kanalda olmalı.
        if (event.channel === 'Admin') return;
        const mesaj = event.message.toLowerCase().trim();

        // Anlaşmalı TK onayı — kurban yazıyor.
        if (config.consensualEnabled && anahtarlar.includes(mesaj)) {
          const saldiran = sonKurbanlar.get(event.steamId);
          const b = saldiran ? bekleyenler.get(saldiran) : undefined;
          if (saldiran && b) {
            temizle(saldiran);
            sonKurbanlar.delete(event.steamId);
            await ctx.rcon.warn(event.steamId, config.consensualConfirmMessage);
            await ctx.rcon.warn(b.hedefId, config.consensualConfirmMessage);
            ctx.log.info({ kurban: event.steamId, saldiran }, 'anlaşmalı TK onaylandı');
          }
          return;
        }

        // Normal özür.
        const b = bekleyenler.get(event.steamId);
        if (!b) return;
        if (!kelimeler.some((k) => mesaj.includes(k))) return;
        temizle(event.steamId);
        await ctx.rcon.warn(b.hedefId, config.thankYouMessage);
        ctx.log.info({ oyuncu: event.steamId }, 'özür kabul edildi');
      },

      onDisable() {
        hepsiniTemizle();
      },
    };
  },
} satisfies Plugin<Config>);
