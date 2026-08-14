import type { Plugin, SquadJSOnlinePlayer } from '@altai/squad';
import { z } from 'zod';
import { tanimla } from '../plugin-host.js';

/**
 * Sunucu doldurma (seed) sürelerini takip eder.
 *
 * Eski sistemde bu İKİ plugin'di: `SeedTracker` yalnızca adminleri,
 * `SeedWLTracker` herkesi sayıyordu. Aynı ghost tespiti, aynı checkpoint,
 * aynı orphan kurtarma mantığı iki dosyada ayrı ayrı duruyordu (toplam 816
 * satır) ve ikisi aynı anda çalıştığı için admin bir oyuncunun süresi iki
 * kez tutuluyordu.
 *
 * Burada tek takip var. Ayrım kaydın üstünde taşınıyor:
 *  - `wasAdmin` — oturum sırasında gerçek admin yetkisi var mıydı,
 *  - `seedReason` — sunucu neden seed sayıldı.
 *
 * Bu ayrımı korumak ŞART: admin nöbeti eskiden yalnızca seed HARİTASINDA
 * sayılıyordu, haftalık whitelist ödülü ise sunucu az doluyken de. İkisini
 * tek ölçüte indirmek adminlere hak etmedikleri nöbet süresi yazardı.
 *
 * Toplamı plugin hesaplamıyor. Kapanmış aralıkları olay olarak gönderiyor,
 * toplayan api. Sebebi plan Bölüm 3: agent'ın veritabanı erişimi yok — ama
 * asıl kazanç şu ki haftalık eşik, ödül ve rapor tanımları veriye sahip
 * olan tarafta duruyor, oyun sunucusundaki bir süreçte değil.
 */

const Config = z.object({
  /** Kaç saniyede bir oyuncu listesi taranır. */
  checkIntervalSeconds: z.number().int().min(10).max(300).default(30),
  /**
   * Uzun oturumlar kaç dakikada bir parçalanıp gönderilir.
   *
   * Eskiden buna "checkpoint" deniyordu ve amacı crash'te veri
   * kaybetmemekti. Burada da aynı işi görüyor: agent çökerse yalnızca son
   * parça kaybolur.
   */
  checkpointMinutes: z.number().int().min(5).max(240).default(30),
  /**
   * Bu sayının ALTINDA oyuncu varsa sunucu "seed" sayılır (0 = kapalı).
   * Harita zaten seed/training ise bu ölçüte bakılmaz.
   */
  playerCountThreshold: z.number().int().min(0).max(100).default(50),
  /** Seed haritası sayılan oyun modları. */
  seedGamemodes: z.array(z.string().trim().min(1)).min(1).default(['seed', 'training']),
  /** Bu saniyeden kısa aralıklar gönderilmez — bağlantı gürültüsü. */
  minSessionSeconds: z.number().int().min(0).max(600).default(30),
});

type Config = z.infer<typeof Config>;

interface Takip {
  baslangic: number;
  ad: string;
  steamId: string | null;
  eosId: string | null;
  /** Aralık boyunca admin yetkisi görüldü mü. */
  adminGorulen: boolean;
  sebep: 'gamemode' | 'player_count';
}

/** Oyuncuyu takip haritasında tanımlayan anahtar. */
function anahtar(p: SquadJSOnlinePlayer): string | null {
  return p.eosId ?? p.steamId ?? null;
}

export const seedTracker: ReturnType<typeof tanimla> = tanimla({
  name: 'seed-tracker',
  description: 'Seed sürelerini takip eder (admin nöbeti ve haftalık whitelist için).',
  configSchema: Config,

  create(ctx, config: Config) {
    const takip = new Map<string, Takip>();
    const seedModlari = config.seedGamemodes.map((g) => g.toLowerCase());

    /**
     * Sunucu seed durumunda mı, öyleyse hangi sebeple?
     *
     * `null` = seed değil. Sebep önemli: iki farklı raporun tanımı buna
     * dayanıyor (bkz. dosya başı).
     */
    async function seedDurumu(): Promise<'gamemode' | 'player_count' | null> {
      const durum = await ctx.status();

      const layer = (durum.currentLayer ?? '').toLowerCase();
      if (seedModlari.some((g) => layer.includes(g))) return 'gamemode';

      // Sunucu BOŞSA seed sayılmıyor. Eski plugin'de de böyleydi ve
      // sebebi şu: kimsenin olmadığı bir sunucuda "doldurma" diye bir şey
      // yok, olsaydı sunucu kapalıyken herkes süre biriktirirdi.
      if (
        config.playerCountThreshold > 0 &&
        durum.playerCount > 0 &&
        durum.playerCount < config.playerCountThreshold
      ) {
        return 'player_count';
      }

      return null;
    }

    /** Kapanan aralığı api'ye gönderir. */
    function araligiGonder(t: Takip, bitis: number) {
      const saniye = Math.floor((bitis - t.baslangic) / 1000);
      // Çok kısa aralıklar gönderilmiyor: harita geçişlerinde oyuncular
      // saniyeler içinde düşüp geri geliyor ve bu gürültü tabloyu
      // anlamsız satırlarla dolduruyordu.
      if (saniye < config.minSessionSeconds) return;

      ctx.emit({
        type: 'SEED_SESSION',
        serverSlug: ctx.serverSlug,
        playerName: t.ad,
        ...(t.steamId ? { steamId: t.steamId } : {}),
        ...(t.eosId ? { eosId: t.eosId } : {}),
        startedAt: new Date(t.baslangic).toISOString(),
        endedAt: new Date(bitis).toISOString(),
        durationSeconds: saniye,
        seedReason: t.sebep,
        wasAdmin: t.adminGorulen,
        timestamp: new Date().toISOString(),
      });
    }

    /** Takibi kapatır ve aralığı gönderir. */
    function bitir(k: string, bitis = Date.now()) {
      const t = takip.get(k);
      if (!t) return;
      takip.delete(k);
      araligiGonder(t, bitis);
    }

    function hepsiniBitir() {
      const simdi = Date.now();
      for (const k of [...takip.keys()]) bitir(k, simdi);
    }

    async function tara() {
      const sebep = await seedDurumu();

      if (sebep === null) {
        // Sunucu canlıya geçti: biriken süreler yazılıp takip kapanıyor.
        hepsiniBitir();
        return;
      }

      const oyuncular = await ctx.players();
      const simdi = Date.now();
      const cevrimici = new Set<string>();

      for (const p of oyuncular) {
        const k = anahtar(p);
        if (!k) continue;
        cevrimici.add(k);

        const mevcut = takip.get(k);

        // Seed SEBEBİ değiştiyse (harita seed'den çıktı ama sunucu hâlâ
        // az dolu) aralık kapatılıp yenisi açılıyor. Aksi hâlde tek satır
        // iki farklı sebebe ait süreyi taşır ve admin nöbeti raporu
        // olduğundan uzun çıkardı.
        if (mevcut && mevcut.sebep !== sebep) {
          bitir(k, simdi);
        }

        const t = takip.get(k);
        if (t) {
          // Eksik kimlikleri tamamla: RCON listesi bazen önce yalnızca EOS
          // ile geliyor, SteamID sonraki turda dolıyor.
          if (!t.steamId && p.steamId) t.steamId = p.steamId;
          if (!t.eosId && p.eosId) t.eosId = p.eosId;
          if (!t.adminGorulen && ctx.gercekAdminMi(p.steamId, p.eosId)) t.adminGorulen = true;

          // Checkpoint: uzun oturumu parçala.
          if (simdi - t.baslangic >= config.checkpointMinutes * 60_000) {
            araligiGonder(t, simdi);
            t.baslangic = simdi;
          }
          continue;
        }

        takip.set(k, {
          baslangic: simdi,
          ad: p.name,
          steamId: p.steamId ?? null,
          eosId: p.eosId ?? null,
          adminGorulen: ctx.gercekAdminMi(p.steamId, p.eosId),
          sebep,
        });
      }

      // Hayalet temizliği: takipte olup listede olmayan = ayrılma olayı
      // kaçmış. Eski plugin'de bu ayrı bir "ghost cleanup" turuydu; burada
      // taramanın doğal sonucu.
      for (const k of [...takip.keys()]) {
        if (!cevrimici.has(k)) bitir(k);
      }
    }

    ctx.every(config.checkIntervalSeconds * 1000, tara);

    return {
      onEvent(event) {
        // Ayrılan oyuncunun süresi bir sonraki taramayı beklemesin.
        //
        // PLAYER_DISCONNECTED yalnızca SteamID taşıyor, takip anahtarı ise
        // EOS olabilir. Anahtarı doğrudan aramak, EOS ile takip edilen
        // oyuncunun ayrılışını kaçırır ve süresi ancak bir sonraki
        // taramanın hayalet temizliğinde yazılırdı.
        if (event.type === 'PLAYER_DISCONNECTED') {
          if (takip.has(event.steamId)) {
            bitir(event.steamId);
            return;
          }
          for (const [k, t] of takip) {
            if (t.steamId === event.steamId) {
              bitir(k);
              return;
            }
          }
          return;
        }

        // Harita değişimi ve round sonu: aralıkları KAPAT. Yeni haritanın
        // seed olup olmadığı bilinmiyor ve açık bir aralığı yeni haritaya
        // taşımak, canlı maçta seed süresi yazmak demek olurdu.
        if (event.type === 'ROUND_ENDED' || event.type === 'ROUND_STARTED') {
          hepsiniBitir();
        }
      },

      onDisable() {
        // Kapanışta biriken süre yazılıyor; hot-reload süre kaybettirmemeli.
        hepsiniBitir();
      },
    };
  },
} satisfies Plugin<Config>);
