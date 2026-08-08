import { logger } from '@altai/shared';
import { Archive } from './archive.js';
import { BmClient } from './bm-client.js';
import { exportList, readResourceIds, resolveServers } from './export-list.js';
import { exportFlagAssignments, readNoteCandidates } from './flag-assignments.js';
import { exportPerPlayer } from './per-player.js';
import { formatProbeTable, probeAll } from './probe.js';
import { formatReport } from './report.js';
import {
  type ExportContext,
  LIST_RESOURCES,
  PER_PLAYER_RESOURCES,
  SERVER_HISTORY_RESOURCES,
  SERVER_LIST_RESOURCES,
} from './resources.js';
import { exportServerHistory, exportServerLists } from './server-history.js';

/**
 * BattleMetrics ham arşiv aracı — plan Bölüm 5.5-A.
 *
 * Tek işi var: BM aboneliği iptal edilmeden ÖNCE, BM'de duran her şeyi
 * diske ham JSON olarak indirmek. Dönüştürme/temizleme yok (o Faz 2 ETL'i) —
 * burada tek hedef, geri dönüşü olmayan veri kaybını engellemek.
 *
 * Kullanım:
 *   pnpm bm:export -- --probe            uçları yokla, hiçbir şey indirme
 *   pnpm bm:export                       tam arşiv (devam edilebilir)
 *   pnpm bm:export -- --only players,bans
 *   pnpm bm:export -- --skip sessions,player-notes
 *   pnpm bm:export -- --reset players    bir kaynağı sıfırdan çek
 *   pnpm bm:export -- --report           mevcut arşivin durumunu yazdır
 *   pnpm bm:export -- --notes-scope all  notları TÜM oyuncular için çek (saatler)
 */

interface Cli {
  probe: boolean;
  report: boolean;
  only: string[];
  skip: string[];
  reset: string[];
  limit?: number;
  concurrency: number;
  /**
   * candidates (varsayılan): notlar sadece flag'i veya banı olan oyuncular
   * için sorulur — dakikalar sürer, pratikte notların neredeyse tamamını yakalar.
   * all: her oyuncu tek tek sorulur — tam kapsam, saatler sürer.
   */
  notesScope: 'candidates' | 'all';
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    probe: false,
    report: false,
    only: [],
    skip: [],
    reset: [],
    concurrency: 4,
    notesScope: 'candidates',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case '--probe':
        cli.probe = true;
        break;
      case '--report':
        cli.report = true;
        break;
      case '--only':
        cli.only = (value ?? '').split(',').filter(Boolean);
        i++;
        break;
      case '--skip':
        cli.skip = (value ?? '').split(',').filter(Boolean);
        i++;
        break;
      case '--reset':
        cli.reset = (value ?? '').split(',').filter(Boolean);
        i++;
        break;
      case '--limit':
        cli.limit = Number(value);
        i++;
        break;
      case '--concurrency':
        cli.concurrency = Number(value);
        i++;
        break;
      case '--notes-scope':
        if (value !== 'candidates' && value !== 'all') {
          logger.error({ value }, '--notes-scope sadece "candidates" veya "all" olabilir');
          process.exit(1);
        }
        cli.notesScope = value;
        i++;
        break;
      case '--':
        // npm/pnpm "start -- --report" çağrısında araya giren ayraç.
        break;
      default:
        if (arg?.startsWith('--')) {
          logger.warn({ arg }, 'bilinmeyen argüman — yok sayıldı');
        }
    }
  }
  return cli;
}

const cli = parseArgs(process.argv.slice(2));

const token = process.env.BATTLEMETRICS_TOKEN;
const organizationId = process.env.BM_ORGANIZATION_ID;
const outDir = process.env.BM_EXPORT_DIR ?? './bm-archive';
const explicitServerIds = (process.env.BM_SERVER_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const requestsPerSecond = Number(process.env.BM_REQUESTS_PER_SECOND ?? '4');
// Sunucularımız bundan önce yoktu — geçmiş uçları bu tarihten itibaren taranır.
const historyStart = new Date(process.env.BM_HISTORY_START ?? '2020-01-01T00:00:00Z');
// BM'nin sunucu geçmişi uçlarındaki sert sınırı: "Start may not be more than
// 90 days ago". Daha eskisi API'den hiçbir şekilde alınamıyor.
const maxDaysBack = Number(process.env.BM_HISTORY_MAX_DAYS ?? '90');

if (!organizationId) {
  logger.error(
    'BM_ORGANIZATION_ID tanımlı değil. BM panelinde Organization ayarlarındaki sayısal ID.',
  );
  process.exit(1);
}

const archive = await Archive.open(outDir, organizationId);

// --report token gerektirmez: sadece diskteki manifest'i okur.
if (cli.report) {
  process.stdout.write(`${formatReport(archive)}\n`);
  process.exit(0);
}

if (!token) {
  logger.error('BATTLEMETRICS_TOKEN tanımlı değil (battlemetrics.com/developers)');
  process.exit(1);
}
if (Number.isNaN(historyStart.getTime())) {
  logger.error('BM_HISTORY_START geçersiz tarih (beklenen: 2020-01-01T00:00:00Z)');
  process.exit(1);
}

// BM_BASE_URL sadece test/kuru koşu içindir (sahte BM sunucusu); üretimde verilmez.
const baseUrl = process.env.BM_BASE_URL;
const client = new BmClient({ token, requestsPerSecond, ...(baseUrl ? { baseUrl } : {}) });

const wanted = (name: string) =>
  (cli.only.length === 0 || cli.only.includes(name)) && !cli.skip.includes(name);

for (const name of cli.reset) {
  logger.warn({ resource: name }, 'kaynak sıfırlanıyor — mevcut veri siliniyor');
  await archive.reset(name);
}

// --skip ile atlanan kaynaklar manifest'e "karar" olarak yazılır. Aksi hâlde
// rapor bunları sonsuza kadar "eksik kritik kaynak" diye gösterir ve zamanla
// görmezden gelinen bir uyarıya dönüşür — tam da güvenilmesi gereken anda.
for (const name of cli.skip) {
  await archive.markSkipped(name, '--skip ile bilinçli olarak arşivlenmedi');
}

// Ctrl+C: açık stream'leri kapat ve manifest'i yaz, yoksa son sayfa kaybolur.
let shuttingDown = false;
const shutdown = async (signal: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.warn({ signal }, 'kapatılıyor — arşiv durumu kaydediliyor');
  await archive.close();
  process.exit(130);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  // --- Faz 0: sunucular (her şeyin filtresi bunlara bağlı) ---
  const serverIds = await resolveServers(client, archive, explicitServerIds);
  const ctx: ExportContext = { organizationId, serverIds };

  // --- --probe: yokla ve çık ---
  if (cli.probe) {
    const samplePlayerId = (await readResourceIds(archive.dataPath('players')))[0];
    const results = await probeAll(client, ctx, samplePlayerId);
    process.stdout.write(`\n${formatProbeTable(results)}\n\n`);
    if (!samplePlayerId) {
      process.stdout.write(
        'Not: oyuncu başına uçlar (notlar, flag atamaları) yoklanamadı.\n' +
          'Önce `pnpm bm:export -- --only players` çalıştırıp tekrar --probe deneyin.\n\n',
      );
    }
    await archive.close();
    process.exit(0);
  }

  // --- Faz 1: sayfalanan liste kaynakları ---
  for (const resource of LIST_RESOURCES) {
    if (!wanted(resource.name)) continue;
    await exportList({
      name: resource.name,
      path: resource.path,
      params: resource.params(ctx),
      client,
      archive,
      critical: resource.critical,
    });
  }

  // --- Faz 2: flag atamaları (flag başına tarama — dakikalar) ---
  if (wanted('player-flag-assignments')) {
    await exportFlagAssignments({ client, archive, ctx });
  }

  // --- Faz 3: notlar (oyuncu başına — kapsam seçimine göre dakikalar/saatler) ---
  for (const resource of PER_PLAYER_RESOURCES) {
    if (!wanted(resource.name)) continue;

    let playerIds: string[] | undefined;
    if (cli.notesScope === 'candidates') {
      playerIds = await readNoteCandidates(archive);
      logger.info(
        { aday: playerIds.length },
        "notlar sadece flag'i/banı olan oyuncular için sorulacak (tam kapsam: --notes-scope all)",
      );
    }

    await exportPerPlayer({
      client,
      archive,
      resource,
      concurrency: Math.max(1, cli.concurrency),
      ...(playerIds ? { playerIds } : {}),
      ...(cli.limit ? { limit: cli.limit } : {}),
    });
  }

  // --- Faz 3: sunucu geçmişi ---
  for (const resource of SERVER_HISTORY_RESOURCES) {
    if (!wanted(resource.name)) continue;
    await exportServerHistory({ client, archive, serverIds, resource, historyStart, maxDaysBack });
  }
  for (const resource of SERVER_LIST_RESOURCES) {
    if (!wanted(resource.name)) continue;
    await exportServerLists(client, archive, serverIds, resource);
  }

  await archive.close();
  process.stdout.write(`\n${formatReport(archive)}\n`);
  logger.info({ istek: client.totalRequests }, 'arşivleme bitti');
} catch (error) {
  await archive.close();
  logger.error(
    { error },
    'arşivleme hata ile durdu — aynı komutu tekrar çalıştırın, kaldığı yerden devam eder',
  );
  process.stdout.write(`\n${formatReport(archive)}\n`);
  process.exit(1);
}
