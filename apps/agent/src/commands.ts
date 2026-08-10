import type { AgentCommand } from '@altai/contracts';
import { logger } from '@altai/shared';
import type { SquadJSEngine } from '@altai/squad';

/**
 * api'den gelen komutları RCON çağrılarına çevirir.
 *
 * Kimlik seçimi: Squad artık oyuncuyu EOS ID ile tanıyor ve admin
 * komutlarında EOS daha güvenilir. SteamID'ye yalnızca EOS yoksa düşüyoruz —
 * eski kayıtlarda EOS olmayabiliyor.
 *
 * `ban` BİLEREK kick'e çevriliyor: kalıcı kayıt bizim veritabanımızda ve
 * sunucu ban listesini bizden çekiyor. Squad'ın kendi `AdminBan` komutu
 * sunucunun yerel Bans.cfg'sine yazar; o dosya bizim ürettiğimiz listeden
 * ayrışır ve iki ayrı doğruluk kaynağı oluşur. Anında yapılması gereken tek
 * şey oyuncuyu o anki maçtan çıkarmak.
 */

export interface KomutSonucu {
  ok: boolean;
  error?: string;
  /** Komuta özel dönüş (listPlayers'ın oyuncu listesi gibi). */
  data?: unknown;
}

/** RCON metin argümanlarında satır sonu komut enjeksiyonuna yol açabilir. */
function tekSatir(v: unknown, ustSinir = 300): string {
  return String(v ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, ustSinir);
}

function oyuncuKimligi(payload: Record<string, unknown>): string | null {
  const eos = tekSatir(payload.eosId, 32);
  if (/^[0-9a-f]{32}$/i.test(eos)) return eos;
  const steam = tekSatir(payload.steamId, 17);
  if (/^7656119\d{10}$/.test(steam)) return steam;
  return null;
}

export async function komutCalistir(
  engine: SquadJSEngine,
  command: AgentCommand,
): Promise<KomutSonucu> {
  const p = command.payload;

  try {
    switch (command.action) {
      // Kanal sağlık kontrolü — RCON'a hiç gitmez, oyunda hiçbir etkisi yok.
      case 'ping':
        return { ok: true };

      case 'kick':
      case 'ban': {
        const id = oyuncuKimligi(p);
        if (!id) return { ok: false, error: 'gecerli_kimlik_yok' };
        const sebep = tekSatir(p.reason) || 'Altai';
        const cevap = await engine.rconExecute(`AdminKick ${id} ${sebep}`);
        logger.info({ action: command.action, id, cevap: cevap.slice(0, 120) }, 'komut çalıştı');
        return { ok: true };
      }

      case 'warn': {
        const id = oyuncuKimligi(p);
        if (!id) return { ok: false, error: 'gecerli_kimlik_yok' };
        const mesaj = tekSatir(p.message);
        if (!mesaj) return { ok: false, error: 'mesaj_bos' };
        await engine.rconExecute(`AdminWarn ${id} ${mesaj}`);
        return { ok: true };
      }

      // Ban uygulamasinin veri kaynagi: api bu listeyi periyodik isteyip
      // aktif ban'i olanlari attiriyor. RCON'a gitmez, SquadJS'in bellekteki
      // guncel listesini dondurur.
      case 'listPlayers': {
        // `taze` istendiğinde önce RCON'dan yeniliyoruz. Bir eylemin
        // (takım değiştirme gibi) hemen ardından okunan önbellek, eylemden
        // ÖNCEKİ durumu döndürüyor ve paneli yanlış gösteriyordu.
        if (p.taze === true) await engine.refreshPlayers();
        const oyuncular = await engine.getPlayers();
        return { ok: true, data: { players: oyuncular } };
      }

      case 'broadcast': {
        const mesaj = tekSatir(p.message);
        if (!mesaj) return { ok: false, error: 'mesaj_bos' };
        await engine.rconExecute(`AdminBroadcast ${mesaj}`);
        return { ok: true };
      }

      /**
       * Takım değiştirme.
       *
       * AdminForceTeamChange HEDEF TAKIM ALMIYOR: oyuncuyu karşı tarafa
       * geçiriyor, o kadar. Yani "1'e al" diye bir şey yok; oyuncu zaten
       * 1'deyse komut onu 2'ye atar. Hedefi panelin doğrulaması gerekiyor.
       */
      case 'forceTeamChange': {
        const id = oyuncuKimligi(p);
        if (!id) return { ok: false, error: 'gecerli_kimlik_yok' };
        const cevap = await engine.rconExecute(`AdminForceTeamChange ${id}`);
        logger.info({ id, cevap: cevap.slice(0, 120) }, 'takım değiştirildi');
        return { ok: true };
      }

      // Sessizce başarılı dönmüyoruz: panelde "yapıldı" yazıp hiçbir şey
      // olmaması, hata döndürmekten daha kötü.
      case 'setLayer':
      case 'restart':
        return { ok: false, error: 'henuz_desteklenmiyor' };

      default: {
        const _exhaustive: never = command.action;
        return { ok: false, error: `bilinmeyen_komut_${String(_exhaustive)}` };
      }
    }
  } catch (err) {
    logger.error({ err, action: command.action }, 'komut çalıştırılamadı');
    return { ok: false, error: err instanceof Error ? err.message : 'rcon_hatasi' };
  }
}
