import { logger } from '@altai/shared';
import { BmClient } from './client.js';
import { aynayiYokla, yoklamaRaporu } from './probe.js';

/**
 * Canlı ayna uç yoklaması — CLI.
 *
 *   pnpm bm:ayna -- 76561198000000000
 *
 * SteamID zorunlu ve ELLE veriliyor: veritabanından çekmek bu paketi
 * @altai/db'ye bağlardı, oysa paketin tamamı BM okumasından ibaret ve
 * böyle kalması gerekiyor. Üstelik yoklamanın doğru cevap vermesi için
 * SUNUCUNUZDA OYNADIĞINI BİLDİĞİNİZ bir oyuncu gerekiyor; bunu rastgele
 * seçmek değil, bilerek vermek gerek.
 */

const args = process.argv.slice(2).filter((a) => a !== '--');
const steamId = args[0];

if (!steamId) {
  logger.error(
    'Kullanım: pnpm bm:ayna -- <steamId>\n' +
      '  Sunucunuzda oynadığını BİLDİĞİNİZ bir oyuncunun SteamID64’ü olmalı.\n' +
      '  BM’de hiç kaydı olmayan bir kimlik, çalışan bir ucu "bulunamadı" diye raporlar.',
  );
  process.exit(1);
}

if (!/^\d{17}$/.test(steamId)) {
  // SteamID64 17 hanelidir. Yanlış biçim verilince yoklama "eşleşme yok"
  // diyecekti ve bu, çalışan bir ucu bozuk göstermek olurdu.
  logger.error({ steamId }, 'SteamID64 beklenir (17 hane). Verilen değer o biçimde değil.');
  process.exit(1);
}

const token = process.env.BATTLEMETRICS_TOKEN;
if (!token) {
  logger.error('BATTLEMETRICS_TOKEN tanımlı değil (battlemetrics.com/developers)');
  process.exit(1);
}

const serverIds = (process.env.BM_SERVER_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// Yoklama 6 istekten fazla atmıyor; hız limiti burada darboğaz değil ama
// arşiv koşuyor olabilir, o yüzden ihtiyatlı.
const client = new BmClient({ token, requestsPerSecond: 2 });
const sonuclar = await aynayiYokla(client, {
  steamId,
  ...(serverIds.length > 0 ? { serverIds } : {}),
});

process.stdout.write(`${yoklamaRaporu(sonuclar).join('\n')}\n`);

// Kritik bir uç sorunluysa çıkış kodu 1: betikten çağrıldığında fark edilsin.
process.exit(sonuclar.some((s) => s.kritik && s.durum !== 'ok') ? 1 : 0);
