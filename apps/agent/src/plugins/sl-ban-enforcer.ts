import type { Plugin, SquadJSOnlinePlayer } from '@altai/squad';
import { z } from 'zod';
import { tanimla } from '../plugin-host.js';

/**
 * "SL ban" etiketi olan oyuncuyu manga liderliğinden çıkarır.
 *
 * Eski plugin bu bilgiyi BattleMetrics'ten çekiyordu: her tetiklemede
 * `/players/quick-match` ile BM kimliğini bulup `/relationships/flags`
 * çağırıyor, dönen listede "SL BAN" adlı aktif etiketi arıyordu. BM
 * emekliye ayrıldığı için kaynak artık BİZİM veritabanımız —
 * `flags` + `flag_assignments`, panelden yönetilen etiketlerin aynısı.
 *
 * Veriyi plugin okumuyor: agent'ın Postgres erişimi yok (plan Bölüm 3).
 * `ctx.oyuncuEtiketleri` uplink üzerinden api'ye soruyor, cevabı api veriyor.
 *
 * SORGU CEVAPSIZ KALIRSA YAPTIRIM UYGULANMAZ. Eski plugin'de de sonuç
 * buydu ama sebebi görünmüyordu: BM'ye ulaşılamadığında `hasSLBanFlag`
 * sessizce `false` dönüyor, yani hata "bu oyuncunun yasağı yok" cevabıyla
 * aynı kapıya çıkıyordu. Burada ikisi ayrı: `null` = bilmiyoruz ve
 * loglanıyor, `{bulundu, flags}` = biliyoruz. Yanlışlıkla birini mangadan
 * atmaktansa bilinmeyen durumda dokunmamak doğru taraf, ama bunun bir
 * karar olduğu kayıtta duruyor.
 *
 * Periyodik tarama eski sistemde YOKTU (her sorgu BM'ye gidiyordu, kota
 * vardı). Kendi veritabanımızı sormak ucuz olduğu için eklendi: kaçan bir
 * olay ya da cevapsız kalan bir sorgu bir sonraki turda yakalanıyor.
 */

const Config = z.object({
  /** Aranan etiketin adı — karşılaştırma büyük/küçük harf duyarsız. */
  flagName: z.string().trim().min(1).max(64).default('SL BAN'),
  warnMessage: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .default('SL yasağın bulunuyor. Manga liderliğinden çıkarıldın.'),
  /** SL kiti sayılan rolleri tanıyan kalıplar (regex, harf duyarsız). */
  leaderRolePatterns: z
    .array(z.string().trim().min(1))
    .min(1)
    .default(['Leader', 'Officer', 'SL', 'SquadLeader']),
  /**
   * Aynı oyuncu bu süre içinde ikinci kez işleme alınmaz.
   *
   * Mangadan çıkarma birden fazla olay tetikliyor (rol değişimi + liderlik
   * kaybı); bu olmadan tek bir çıkarma için üst üste uyarı gidiyordu.
   */
  cooldownSeconds: z.number().int().min(5).max(300).default(15),
  /**
   * Manga kurulduktan sonra çıkarmadan önce beklenen süre.
   *
   * Eski plugin'de de vardı: manga kurulur kurulmaz kurucuyu çıkarmak
   * bazen oyun tarafında henüz yerleşmemiş duruma denk geliyor ve komut
   * boşa gidiyordu.
   */
  squadCreateDelayMs: z.number().int().min(0).max(10_000).default(1_000),
  /** Periyodik tarama aralığı. 0 = tarama kapalı, yalnızca olaylar. */
  sweepIntervalSeconds: z.number().int().min(0).max(3600).default(120),
});

type Config = z.infer<typeof Config>;

/** RCON'un hedef alacağı kimlik. EOS tercih ediliyor. */
function kimlik(steamId?: string | null, eosId?: string | null): string | null {
  if (eosId && /^[0-9a-f]{32}$/i.test(eosId)) return eosId;
  if (steamId && /^7656119\d{10}$/.test(steamId)) return steamId;
  return null;
}

function oyuncuKimligi(p: SquadJSOnlinePlayer): string | null {
  return kimlik(p.steamId, p.eosId);
}

export const slBanEnforcer: ReturnType<typeof tanimla> = tanimla({
  name: 'sl-ban-enforcer',
  description: 'SL ban etiketi olan oyuncuları manga liderliğinden çıkarır.',
  configSchema: Config,

  create(ctx, config: Config) {
    const aranan = config.flagName.toLocaleUpperCase('tr-TR');

    const kalip = config.leaderRolePatterns.map((p) => {
      try {
        return new RegExp(p, 'i');
      } catch {
        // Geçersiz regex ayarı plugin'i düşürmesin; düz metin araması yap.
        return new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      }
    });

    const liderRolu = (role: string | null | undefined) =>
      Boolean(role) && kalip.some((r) => r.test(role as string));

    /** kimlik -> son çıkarma zamanı. */
    const sonCikarma = new Map<string, number>();
    /** Cevabı beklenen sorgular — aynı oyuncu için ikinci sorgu açılmasın. */
    const suregelen = new Set<string>();
    let kapali = false;

    const beklemedeMi = (k: string) => {
      const son = sonCikarma.get(k);
      return son !== undefined && Date.now() - son < config.cooldownSeconds * 1000;
    };

    /**
     * Yasak var mı? `null` = cevap yok (bilmiyoruz), yaptırım uygulanmamalı.
     */
    async function yasakliMi(
      steamId: string | null | undefined,
      eosId: string | null | undefined,
      oyuncuAdi: string,
    ): Promise<boolean | null> {
      const cevap = await ctx.oyuncuEtiketleri(steamId, eosId);
      if (cevap === null) {
        ctx.log.warn(
          { oyuncu: oyuncuAdi, steamId, eosId },
          'etiket sorgusu cevapsız kaldı — SL yasağı denetlenemedi',
        );
        return null;
      }
      // Oyuncu veritabanında hiç yoksa (`bulundu: false`) yasağı da yok.
      // Bu bir cevap, boşluk değil: yeni oyuncunun etiketi olamaz.
      return cevap.flags.some((f) => f.toLocaleUpperCase('tr-TR') === aranan);
    }

    async function uygula(
      steamId: string | null | undefined,
      eosId: string | null | undefined,
      oyuncuAdi: string,
      sebep: string,
      gecikmeMs = 0,
    ): Promise<boolean> {
      const k = kimlik(steamId, eosId);
      // Kimliksiz oyuncuya komut göndermek yanlış kişiyi cezalandırma riski.
      if (!k) return false;
      if (beklemedeMi(k) || suregelen.has(k)) return false;

      suregelen.add(k);
      try {
        const yasakli = await yasakliMi(steamId, eosId, oyuncuAdi);
        if (yasakli !== true) return false;

        if (gecikmeMs > 0) {
          await new Promise((r) => setTimeout(r, gecikmeMs));
          // Bekleme sırasında plugin kapatılmış olabilir; kapalı bir
          // plugin'in RCON komutu göndermesi hot-reload'ı anlamsız kılar.
          if (kapali) return false;
        }

        await ctx.rcon.warn(k, config.warnMessage);
        await ctx.rcon.removeFromSquad(k);
        sonCikarma.set(k, Date.now());
        ctx.log.info({ oyuncu: oyuncuAdi, kimlik: k, sebep }, 'SL yasaklısı mangadan çıkarıldı');
        return true;
      } finally {
        suregelen.delete(k);
      }
    }

    async function tara() {
      const oyuncular = await ctx.players();
      for (const p of oyuncular) {
        if (p.squadId === null || p.squadId === undefined) continue;
        if (!p.isLeader && !liderRolu(p.role)) continue;
        const k = oyuncuKimligi(p);
        if (!k || beklemedeMi(k) || suregelen.has(k)) continue;
        await uygula(p.steamId, p.eosId, p.name, 'periyodik tarama');
      }

      // Sunucudan çıkmış oyuncuların bekleme kaydı harita boyunca birikmesin.
      const simdi = Date.now();
      for (const [k, t] of sonCikarma) {
        if (simdi - t >= config.cooldownSeconds * 1000) sonCikarma.delete(k);
      }
    }

    if (config.sweepIntervalSeconds > 0) {
      ctx.every(config.sweepIntervalSeconds * 1000, tara);
    }

    return {
      async onEvent(event) {
        if (event.type === 'SQUAD_CREATED') {
          await uygula(
            event.steamId,
            event.eosId,
            event.playerName,
            'manga kurdu',
            config.squadCreateDelayMs,
          );
          return;
        }

        if (event.type !== 'PLAYER_STATE_CHANGE') return;

        // Liderliği BIRAKAN oyuncuyu denetlemenin anlamı yok; zaten
        // yaptırımın hedeflediği duruma kendisi son vermiş.
        if (event.change === 'became_leader') {
          await uygula(event.steamId, event.eosId, event.playerName, 'lider oldu');
          return;
        }

        // Rol değişimi: yalnızca SL kitine geçildiyse. Squad, kiti alan
        // oyuncuyu her zaman `isLeader` işaretlemiyor.
        if (event.change === 'role' && (event.isLeader || liderRolu(event.role))) {
          await uygula(
            event.steamId,
            event.eosId,
            event.playerName,
            `rol değişimi (${event.oldRole ?? '-'} -> ${event.role ?? '-'})`,
          );
        }
      },

      onDisable() {
        kapali = true;
      },
    };
  },
} satisfies Plugin<Config>);
