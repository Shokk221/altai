import type { Plugin } from '@altai/squad';
import { z } from 'zod';
import { tanimla } from '../plugin-host.js';

/**
 * Oyuncunun Steam hesap seviyesini okur ve api'ye bildirir.
 *
 * İstek şuydu: düşük seviyeli Steam hesaplarını panelde renkli bir rozetle
 * ayırt edebilmek (3'ün altı kırmızı, 5'in altı sarı). Eski sistemde bu
 * BattleMetrics flag'leriyle yapılacaktı; burada kendi `flags` tablomuz
 * zaten aynı işi görüyor ve rozetin rengi de orada duruyor.
 *
 * Plugin ETİKET ATAMIYOR. Yalnızca "bu hesabın seviyesi şu" diyor; hangi
 * seviyenin hangi etiketi hak ettiğine api karar veriyor. Sebep: eşikler
 * değişir (bugün 3, yarın 4) ve değiştiğinde oyun sunucusundaki bir
 * dosyaya dokunmak gerekmemeli. Aynı sebeple etiketin adı ve rengi de
 * veritabanında.
 *
 * GİZLİ PROFİL "SEVİYE 0" DEĞİLDİR. Steam, profili kapalı hesaplar için
 * seviye döndürmüyor; okunamayan seviyeyi 0 saymak, profilini gizleyen
 * herkesi en düşük seviyeymiş gibi damgalardı. Bu durumda `level: null`
 * gidiyor ve api hiçbir etiket atamıyor.
 */

const Config = z.object({
  /** Bağlanma ile sorgu arasındaki gecikme (saniye) — giriş anını yormamak için. */
  delaySeconds: z.number().int().min(0).max(120).default(5),
  /**
   * Bir oyuncunun seviyesi kaç günde bir yeniden okunur.
   *
   * Steam seviyesi yavaş değişen bir veri; her girişte sormak Steam
   * kotasını boşa harcar. api zaten en son ne zaman okunduğunu biliyor,
   * plugin ona sorup gerekmiyorsa hiç istek atmıyor.
   */
  recheckDays: z.number().int().min(1).max(365).default(30),
  /** Gizli profil kaç günde bir yeniden denenir (kullanıcı açmış olabilir). */
  privateRecheckDays: z.number().int().min(1).max(365).default(7),
});

type Config = z.infer<typeof Config>;

export const steamLevel: ReturnType<typeof tanimla> = tanimla({
  name: 'steam-level',
  description: 'Oyuncuların Steam hesap seviyesini okur; etiketlemeyi api yapar.',
  configSchema: Config,

  create(ctx, config: Config) {
    const anahtar = ctx.secrets.steamApiKey;
    if (!anahtar) {
      ctx.log.warn(
        {},
        'STEAM_API_KEY yok — Steam seviyesi okunamayacak (plugin açık ama iş yapmıyor)',
      );
    }

    /** Bu oturumda zaten sorulmuş SteamID'ler — aynı girişte iki istek atmasın. */
    const bekleyen = new Set<string>();
    let kapali = false;

    /**
     * Profil gizli mi? Steam'in KENDİ görünürlük alanına bakılıyor.
     *
     * `communityvisibilitystate`: 3 = herkese açık, diğer değerler kapalı.
     * (Aynı alan `playtime-squad-guard` içinde de bu iş için kullanılıyor.)
     */
    async function gizliMi(steamId: string): Promise<boolean | null> {
      try {
        const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${anahtar}&steamids=${steamId}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const veri = (await res.json()) as {
          response?: { players?: Array<{ communityvisibilitystate?: number }> };
        };
        const gorunurluk = veri.response?.players?.[0]?.communityvisibilitystate;
        if (typeof gorunurluk !== 'number') return null;
        return gorunurluk !== 3;
      } catch {
        return null;
      }
    }

    /**
     * Steam'den seviyeyi okur.
     *
     * Dönüş: `{ level }` okunduysa, `{ private: true }` profil gizliyse,
     * `null` bilinmiyorsa. Üçü FARKLI durumlar ve üçüne farklı davranılıyor
     * — "okunamadı"yı "seviye 0" saymak bu plugin'in yapabileceği en
     * zararlı hata: profilini kapatmış herkes kırmızı etiket alırdı.
     *
     * Seviye gelmediğinde gizliliğe TAHMİNLE karar verilmiyor. Önce
     * "`player_level` alanı yoksa profil gizlidir" deniyordu; bu, Steam'in
     * gizli profil için ne döndürdüğüne dair doğrulanmamış bir varsayımdı
     * ve yanlış çıkarsa (örneğin 0 dönerse) tam da önlemek istediğimiz
     * zararı verirdi. Artık görünürlük Steam'e ayrıca soruluyor.
     */
    async function seviyeOku(
      steamId: string,
    ): Promise<{ level: number } | { private: true } | null> {
      if (!anahtar) return null;
      try {
        const url = `https://api.steampowered.com/IPlayerService/GetSteamLevel/v1/?key=${anahtar}&steamid=${steamId}`;
        const res = await fetch(url);
        if (!res.ok) {
          ctx.log.warn({ steamId, durum: res.status }, 'Steam seviye isteği başarısız');
          return null;
        }
        const veri = (await res.json()) as { response?: { player_level?: number } };
        const seviye = veri.response?.player_level;
        if (typeof seviye === 'number') return { level: seviye };

        // Seviye yok: gizli mi, yoksa başka bir sebep mi? Bu ek istek
        // yalnızca seviye gelmediğinde atılıyor, yani nadiren.
        const gizli = await gizliMi(steamId);
        if (gizli === true) return { private: true };

        // Profil AÇIK ama seviye yok — beklenmedik. Bilmediğimiz bir
        // durumda kayıt yazmak, bir sonraki denemeyi de erteler.
        ctx.log.warn({ steamId, gizli }, 'Steam seviyesi gelmedi ve profil gizli değil');
        return null;
      } catch (err) {
        ctx.log.warn({ err, steamId }, 'Steam API okunamadı');
        return null;
      }
    }

    /** api'de taze kayıt var mı? Bilinmiyorsa okumayı dene (null -> false). */
    async function tazeMi(steamId: string): Promise<boolean> {
      const cevap = await ctx.steamSeviyeTazeMi(
        steamId,
        config.recheckDays,
        config.privateRecheckDays,
      );
      // `null` = bilmiyoruz. Taze SAYMIYORUZ: sorgu koptuğu için verinin
      // hiç toplanmaması, birkaç fazla Steam isteğinden kötü.
      return cevap?.taze === true;
    }

    async function isle(steamId: string) {
      if (bekleyen.has(steamId)) return;
      bekleyen.add(steamId);
      try {
        if (config.delaySeconds > 0) {
          await new Promise((r) => setTimeout(r, config.delaySeconds * 1000));
          if (kapali) return;
        }

        // api'de taze kayıt varsa Steam'e hiç gitme.
        if (await tazeMi(steamId)) return;

        const sonuc = await seviyeOku(steamId);
        // İstek başarısızsa hiçbir şey bildirilmiyor: "okunamadı" kaydı
        // yazmak, bir sonraki denemeyi de gereksizce erteler.
        if (sonuc === null) return;

        ctx.emit({
          type: 'STEAM_LEVEL',
          serverSlug: ctx.serverSlug,
          steamId,
          level: 'level' in sonuc ? sonuc.level : null,
          private: 'private' in sonuc,
          timestamp: new Date().toISOString(),
        });
      } finally {
        bekleyen.delete(steamId);
      }
    }

    return {
      async onEvent(event) {
        if (event.type !== 'PLAYER_CONNECTED') return;
        // Seviye yalnızca SteamID ile sorulabiliyor.
        if (!event.steamId) return;
        await isle(event.steamId);
      },

      onDisable() {
        kapali = true;
      },
    };
  },
} satisfies Plugin<Config>);
