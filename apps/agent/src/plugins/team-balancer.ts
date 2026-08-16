import type { AgentEvent } from '@altai/contracts';
import type { Plugin, SquadJSOnlinePlayer } from '@altai/squad';
import { z } from 'zod';
import { komutAyristir, komutEslesti } from '../chat-command.js';
import { tanimla } from '../plugin-host.js';

/**
 * Bir taraf üst üste kazanınca takımları karıştırır.
 *
 * Eski `teambalancer` 2617 satırdı ve DÖRT ayrı işi birden yapıyordu:
 * galibiyet serisi takibi, karıştırma, klan bütünlüğü (aynı klanı bir
 * arada, rakip klanları ayrı tutmak) ve yetenek puanına göre dengeleme.
 * Buradaki ilk ikisi; diğer ikisi bizde henüz olmayan veriye dayanıyor
 * (klan üyeliği tablosu ve oyuncu istatistikleri) ve o veri gelene kadar
 * yazılsa her seferinde "bilmiyorum" alıp sessizce atlanacaktı.
 *
 * SERİ SAYACI TUTULMUYOR. Eski plugin bunu kendi SQLite dosyasında
 * tutuyordu çünkü SquadJS'in maç geçmişi yoktu. Bizde `rounds` tablosu
 * var ve seri ondan türetiliyor: ikinci bir doğruluk kaynağı, agent
 * yeniden başladığında ya da maç kaydı ile sayaç ayrıştığında yanlış
 * karıştırma demekti.
 *
 * MANGALAR BOZULMUYOR. Karıştırma manga birimiyle yapılıyor: bir manga
 * ya tümüyle karşıya geçiyor ya da yerinde kalıyor. Oyuncu bazında
 * karıştırmak dengeyi daha iyi tuttururdu ama birlikte oynayan insanları
 * dağıtmak, dengesizlikten daha çok şikâyet üretiyordu.
 */

const Config = z.object({
  /** Aynı taraf kaç kez üst üste kazanınca karıştırılır. 0 = kapalı. */
  maxWinStreak: z.number().int().min(0).max(10).default(2),
  /**
   * Tek maçta bu kadar bilet farkıyla kazanan taraf, seri beklemeden
   * karıştırmayı tetikler. 0 = kapalı.
   */
  dominantWinTicketDiff: z.number().int().min(0).max(1000).default(250),
  /** Mangaların yüzde kaçı karşı tarafa geçirilir. */
  scramblePercentage: z.number().min(0.1).max(1).default(0.5),
  /** Duyuru ile karıştırma arasındaki süre (saniye). */
  announceDelaySeconds: z.number().int().min(0).max(120).default(12),
  /** İki takım değişimi komutu arasındaki bekleme (ms). */
  commandDelayMs: z.number().int().min(0).max(2000).default(200),
  /** Bir oyuncu için en fazla kaç kez denenir. */
  maxAttemptsPerPlayer: z.number().int().min(1).max(10).default(3),
  /** Bu sayıdan az oyuncu varken karıştırma yapılmaz. */
  minPlayers: z.number().int().min(0).max(100).default(20),
  announceMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('Takımlar dengeleniyor — mangalar karşı tarafa geçirilecek.'),
  doneMessage: z.string().trim().min(1).max(200).default('Takımlar dengelendi.'),
  /** Admin komutu (elle karıştırma). */
  command: z.string().trim().min(1).max(32).default('scramble'),
  prefix: z.string().trim().min(1).max(3).default('!'),
  channels: z
    .array(z.enum(['All', 'Team', 'Squad', 'Admin']))
    .min(1)
    .default(['Admin']),
  /**
   * Klan üyeleri bir arada tutulsun mu.
   *
   * Üyelik api'den geliyor (panelden SteamID listesiyle yönetiliyor).
   * Kapalıysa klan hiç sorulmuyor — gereksiz sorgu atılmıyor.
   */
  keepClansTogether: z.boolean().default(true),
  /**
   * Karşı taraflarda tutulacak klan çiftleri.
   *
   * Rekabet halindeki iki klanı aynı takıma koymak, dengeyi bozmasa bile
   * maçı tatsızlaştırıyor — eski plugin'de de ayrı bir ayardı.
   */
  rivalClans: z.array(z.tuple([z.string().trim().min(1), z.string().trim().min(1)])).default([]),
  /**
   * Karıştırmadan sonra takım değiştirme kaç dakika kapalı kalır.
   *
   * `team-switch` plugin'i bu işareti okuyor. 0 = kilit yok.
   */
  scrambleLockdownMinutes: z.number().int().min(0).max(120).default(20),
  /** Elle karıştırma onay ister mi. */
  requireConfirmation: z.boolean().default(true),
  /** Onay için tanınan süre (saniye). */
  confirmationTimeoutSeconds: z.number().int().min(10).max(600).default(60),
});

type Config = z.infer<typeof Config>;

interface MacOzeti {
  winnerTeam: number | null;
  winnerTickets: number | null;
  loserTickets: number | null;
}

/**
 * Kaç maçtır aynı taraf kazanıyor?
 *
 * Liste YENİDEN ESKİYE sıralı. Beraberlik ya da bilinmeyen sonuç seriyi
 * kırıyor: sonucu bilinmeyen bir maçı "seri devam etti" saymak, olmayan
 * bir dengesizlik yüzünden takımları karıştırmak olurdu.
 */
export function galibiyetSerisi(maclar: MacOzeti[]): { takim: number; seri: number } {
  const ilk = maclar[0]?.winnerTeam;
  if (ilk !== 1 && ilk !== 2) return { takim: 0, seri: 0 };

  let seri = 0;
  for (const m of maclar) {
    if (m.winnerTeam !== ilk) break;
    seri++;
  }
  return { takim: ilk, seri };
}

/** Oyuncuları mangalara ayırır. Mangasızlar tek tek ele alınıyor. */
function mangalaraBol(
  oyuncular: SquadJSOnlinePlayer[],
  teamId: number,
): Array<{ squadId: number | null; uyeler: SquadJSOnlinePlayer[] }> {
  const gruplar = new Map<string, SquadJSOnlinePlayer[]>();
  for (const p of oyuncular) {
    if (p.teamId !== teamId) continue;
    // Mangasız oyuncular kendi başlarına birer grup: onları bir arada
    // tutmanın anlamı yok ve tek tek taşınmaları dengeyi ince ayarlıyor.
    const anahtar =
      p.squadId === null ? `yalniz:${p.steamId ?? p.eosId ?? Math.random()}` : `m:${p.squadId}`;
    const mevcut = gruplar.get(anahtar);
    if (mevcut) mevcut.push(p);
    else gruplar.set(anahtar, [p]);
  }
  return [...gruplar.entries()].map(([k, uyeler]) => ({
    squadId: k.startsWith('m:') ? Number(k.slice(2)) : null,
    uyeler,
  }));
}

function kimlik(p: SquadJSOnlinePlayer): string | null {
  return p.eosId ?? p.steamId ?? null;
}

/**
 * Hangi mangaların taşınacağını seçer.
 *
 * Hedef, her taraftan yaklaşık `yuzde` kadar oyuncuyu karşıya geçirmek.
 * Mangalar büyükten küçüğe deneniyor: küçük mangalarla başlanırsa hedefe
 * yaklaşmak için çok sayıda manga taşınıyor ve karıştırma "herkes yer
 * değiştirdi" hâline geliyor.
 */
export function tasinacakMangalar<T extends { uyeler: unknown[] }>(
  gruplar: T[],
  yuzde: number,
): T[] {
  const toplam = gruplar.reduce((n, g) => n + g.uyeler.length, 0);
  const hedef = Math.round(toplam * yuzde);
  if (hedef <= 0) return [];

  const sirali = [...gruplar].sort((a, b) => b.uyeler.length - a.uyeler.length);
  const secilen: T[] = [];
  let sayac = 0;

  for (const g of sirali) {
    if (sayac >= hedef) break;
    // Hedefi AŞMAK, altında kalmaktan iyi: eksik taşımak dengesizliği
    // olduğu gibi bırakır.
    secilen.push(g);
    sayac += g.uyeler.length;
  }
  return secilen;
}

/**
 * Aynı klanın üyelerini tek gruba toplar.
 *
 * Karıştırma manga birimiyle çalışıyor ama klan üyeleri farklı mangalara
 * dağılmış olabiliyor. Onları ayrı ayrı taşımak, klanı ikiye bölmek
 * demek — tam da önlenmek istenen şey. Birleştirilen grup artık tek
 * parça hareket ediyor.
 *
 * `klanlar`: kimlik -> klan adı. Klanı olmayan oyuncular kendi
 * gruplarında kalıyor.
 */

/**
 * Rakip klanların aynı tarafa düşmesini engeller.
 *
 * Plandaki iki grup rakip klanlara aitse İKİNCİSİ plandan çıkarılıyor —
 * yani yerinde kalıyor. Böylece ikisi farklı taraflarda kalmaya devam
 * ediyor. Eşleştirme klan adına göre ve harf duyarsız.
 */
export function rakipleriAyir<T extends { klan: string | null }>(
  plan: T[],
  ciftler: Array<[string, string]>,
): T[] {
  if (ciftler.length === 0) return plan;

  const normalize = (s: string) => s.trim().toLocaleUpperCase('tr-TR');
  const rakipHaritasi = new Map<string, string>();
  for (const [a, b] of ciftler) {
    rakipHaritasi.set(normalize(a), normalize(b));
    rakipHaritasi.set(normalize(b), normalize(a));
  }

  const tasinanKlanlar = new Set<string>();
  const sonuc: T[] = [];

  for (const g of plan) {
    if (!g.klan) {
      sonuc.push(g);
      continue;
    }
    const ad = normalize(g.klan);
    const rakip = rakipHaritasi.get(ad);
    // Rakibi zaten taşınıyorsa bu grubu taşımak ikisini aynı tarafa
    // getirirdi.
    if (rakip && tasinanKlanlar.has(rakip)) continue;
    tasinanKlanlar.add(ad);
    sonuc.push(g);
  }

  return sonuc;
}

export function klanlariBirlestir<
  T extends { uyeler: Array<{ steamId: string | null; eosId: string | null }> },
>(gruplar: T[], klanlar: Map<string, string>): Array<{ uyeler: T['uyeler']; klan: string | null }> {
  const klanGruplari = new Map<string, T['uyeler']>();
  const kalanlar: Array<{ uyeler: T['uyeler']; klan: string | null }> = [];

  for (const g of gruplar) {
    // Grubun klanı: üyelerinin ÇOĞUNLUĞUNUN klanı. Karışık bir mangayı
    // bir klana yazmak, o klanın olmayan üyelerini de taşır; çoğunluk
    // kuralı bu hatayı en aza indiriyor.
    const sayim = new Map<string, number>();
    for (const u of g.uyeler) {
      const k = klanlar.get(u.eosId ?? '') ?? klanlar.get(u.steamId ?? '');
      if (k) sayim.set(k, (sayim.get(k) ?? 0) + 1);
    }

    let baskin: string | null = null;
    let enCok = 0;
    for (const [k, n] of sayim) {
      if (n > enCok) {
        enCok = n;
        baskin = k;
      }
    }

    if (baskin && enCok * 2 > g.uyeler.length) {
      const mevcut = klanGruplari.get(baskin);
      if (mevcut) mevcut.push(...g.uyeler);
      else klanGruplari.set(baskin, [...g.uyeler]);
    } else {
      kalanlar.push({ uyeler: g.uyeler, klan: null });
    }
  }

  return [...[...klanGruplari.entries()].map(([klan, uyeler]) => ({ uyeler, klan })), ...kalanlar];
}

export const teamBalancer: ReturnType<typeof tanimla> = tanimla({
  name: 'team-balancer',
  description: 'Bir taraf üst üste kazanınca mangaları karşı tarafa geçirerek dengeler.',
  configSchema: Config,

  create(ctx, config: Config) {
    let calisiyor = false;
    let kapali = false;
    /** Onay bekleyen elle karıştırma: steamId -> son isteme zamanı. */
    let bekleyenOnay: { steamId: string; zaman: number } | null = null;

    async function karistir(sebep: string) {
      // Aynı anda iki karıştırma, oyuncuların bir kısmını iki kez
      // taşıyıp dengeyi bozardı.
      if (calisiyor) return;
      calisiyor = true;
      try {
        await ctx.refreshPlayers();
        const oyuncular = await ctx.players();

        if (oyuncular.length < config.minPlayers) {
          ctx.log.info({ oyuncu: oyuncular.length }, 'karıştırma atlandı: yeterli oyuncu yok');
          return;
        }

        await ctx.rcon.broadcast(config.announceMessage);
        if (config.announceDelaySeconds > 0) {
          // Oyunculara hazırlanma payı: duyurunun hemen ardından herkesi
          // taşımak, ateş hattındaki insanları ışınlamak demek.
          await new Promise((r) => setTimeout(r, config.announceDelaySeconds * 1000));
          if (kapali) return;
        }

        // Klan üyelikleri: TEK sorgu. Kapalıysa hiç sorulmuyor.
        const klanlar = new Map<string, string>();
        if (config.keepClansTogether) {
          const kimlikler = oyuncular.map(kimlik).filter((k): k is string => k !== null);
          const cevap = await ctx.oyuncuKlanlari(kimlikler);
          if (cevap === null) {
            // Klan bilgisi alınamadı. Karıştırma YİNE YAPILIYOR ama
            // klanlar korunmadan: dengesizliği düzeltmemek, klanları
            // bölmekten daha kötü. Yine de görünür olmalı.
            ctx.log.warn({}, 'klan bilgisi alınamadı — klanlar korunmadan karıştırılıyor');
          } else {
            for (const c of cevap) {
              if (c.steamId) klanlar.set(c.steamId, c.clan);
              if (c.eosId) klanlar.set(c.eosId.toLowerCase(), c.clan);
            }
          }
        }

        // İki taraf da AYNI ANDA planlanıyor: önce bir tarafı taşıyıp
        // sonra listeyi yenilemek, ikinci taraf için bozulmuş bir dünya
        // görüntüsü verirdi.
        const grup1 = klanlariBirlestir(mangalaraBol(oyuncular, 1), klanlar);
        const grup2 = klanlariBirlestir(mangalaraBol(oyuncular, 2), klanlar);

        const secilen1 = tasinacakMangalar(grup1, config.scramblePercentage);
        const secilen2 = tasinacakMangalar(grup2, config.scramblePercentage);

        // Rakip klanlar: ikisi de aynı tarafa düşecekse ikincisi
        // taşınmaktan muaf tutuluyor, böylece karşı taraflarda kalıyorlar.
        const plan = rakipleriAyir([...secilen1, ...secilen2], config.rivalClans);

        let tasinan = 0;
        let basarisiz = 0;
        for (const grup of plan) {
          for (const p of grup.uyeler) {
            if (kapali) return;
            const k = kimlik(p);
            if (!k) continue;

            let oldu = false;
            for (let deneme = 0; deneme < config.maxAttemptsPerPlayer; deneme++) {
              try {
                await ctx.rcon.switchTeam(k);
                oldu = true;
                break;
              } catch (err) {
                // RCON dolu sunucuda tek tük komut düşürüyor; yeniden
                // denemek, oyuncuyu yanlış tarafta bırakmaktan iyi.
                ctx.log.warn({ err, oyuncu: p.name, deneme }, 'takım değişimi başarısız, yeniden');
              }
              if (config.commandDelayMs > 0) {
                await new Promise((r) => setTimeout(r, config.commandDelayMs));
              }
            }

            if (oldu) tasinan++;
            else basarisiz++;

            if (config.commandDelayMs > 0) {
              await new Promise((r) => setTimeout(r, config.commandDelayMs));
            }
          }
        }

        await ctx.rcon.broadcast(config.doneMessage);

        // Takım değiştirme plugin'ine haber: bir süre geçiş kapalı kalsın.
        // Olmasaydı karıştırılan oyuncular anında eski taraflarına döner
        // ve yapılan iş boşa giderdi.
        if (config.scrambleLockdownMinutes > 0) {
          ctx.isaretKoy('scramble', config.scrambleLockdownMinutes * 60);
        }

        ctx.log.info({ sebep, tasinan, basarisiz, manga: plan.length }, 'takımlar karıştırıldı');
      } finally {
        calisiyor = false;
      }
    }

    /** Maç sonunda karıştırma gerekiyor mu? */
    async function gerekliMi(
      event: Extract<AgentEvent, { type: 'ROUND_ENDED' }>,
    ): Promise<string | null> {
      // Ezici galibiyet: seriden bağımsız, tek maçta karar.
      if (config.dominantWinTicketDiff > 0) {
        const kazanan = event.winnerTickets;
        const kaybeden = event.loserTickets;
        if (typeof kazanan === 'number' && typeof kaybeden === 'number') {
          const fark = kazanan - kaybeden;
          if (fark >= config.dominantWinTicketDiff) return `ezici galibiyet (${fark} bilet)`;
        }
      }

      if (config.maxWinStreak <= 0) return null;

      const maclar = await ctx.sonMaclar(config.maxWinStreak + 2);
      if (maclar === null) {
        // Geçmiş okunamadı. Karıştırma YAPILMIYOR: bilmediğimiz bir seri
        // yüzünden takımları dağıtmak, dengesizliği düzeltmekten daha
        // görünür bir hata.
        ctx.log.warn({}, 'maç geçmişi alınamadı — seri kontrolü atlandı');
        return null;
      }

      const { takim, seri } = galibiyetSerisi(maclar);
      if (takim === 0 || seri < config.maxWinStreak) return null;
      return `${takim}. takım ${seri} maçtır kazanıyor`;
    }

    return {
      async onEvent(event) {
        if (event.type === 'ROUND_ENDED') {
          const sebep = await gerekliMi(event);
          if (sebep) await karistir(sebep);
          return;
        }

        if (event.type !== 'CHAT_MESSAGE') return;

        const komut = komutAyristir(event, config.prefix);
        if (!komut || !komutEslesti(komut.ad, config.command)) return;
        if (!config.channels.includes(komut.channel)) return;

        // Kanal yetki değildir.
        if (!ctx.gercekAdminMi(komut.steamId, null)) {
          ctx.log.warn({ steamId: komut.steamId }, 'yetkisiz karıştırma denemesi');
          return;
        }

        if (!config.requireConfirmation) {
          await karistir('admin komutu');
          return;
        }

        const onay = komut.arguman.trim().toLocaleLowerCase('tr-TR');
        const suresiGecti =
          bekleyenOnay !== null &&
          Date.now() - bekleyenOnay.zaman > config.confirmationTimeoutSeconds * 1000;

        if (onay === 'onayla' || onay === 'confirm') {
          if (!bekleyenOnay || suresiGecti) {
            await ctx.rcon.warn(komut.steamId, 'Onaylanacak bekleyen bir karıştırma yok.');
            bekleyenOnay = null;
            return;
          }
          bekleyenOnay = null;
          await karistir('admin komutu (onaylı)');
          return;
        }

        if (onay === 'iptal' || onay === 'cancel') {
          bekleyenOnay = null;
          await ctx.rcon.warn(komut.steamId, 'Karıştırma iptal edildi.');
          return;
        }

        // Onay ADIMI zorunlu: yanlışlıkla yazılan tek bir komut, dolu bir
        // sunucudaki herkesin takımını değiştirebilirdi.
        bekleyenOnay = { steamId: komut.steamId, zaman: Date.now() };
        await ctx.rcon.warn(
          komut.steamId,
          `Onaylamak için: ${config.prefix}${config.command} onayla (${config.confirmationTimeoutSeconds} sn)`,
        );
      },

      onDisable() {
        kapali = true;
        bekleyenOnay = null;
      },
    };
  },
} satisfies Plugin<Config>);
