import { logger } from '@altai/shared';
import { analyzeArchive } from './analyze.js';
import { fileExists } from './ndjson.js';

/**
 * BM arşivi -> Postgres ETL — plan Bölüm 5.5-A/2.
 *
 * İki mod:
 *   --dry-run (varsayılan)  Veritabanına dokunmaz. Arşivi okur, ETL'in ne
 *                           yapacağını ve veride hangi sorunların olduğunu
 *                           raporlar. Postgres GEREKTİRMEZ.
 *   --write                 Gerçek import (Faz 2, panel konteyneri hazır olunca).
 *
 * Kullanım:
 *   pnpm bm:analyze
 *   BM_EXPORT_DIR=/yol/arsive pnpm bm:analyze
 */

const args = process.argv.slice(2);
const write = args.includes('--write');
const dir = process.env.BM_EXPORT_DIR ?? './bm-archive';

if (!fileExists(`${dir}/manifest.json`)) {
  logger.error(
    { dir },
    'arşiv bulunamadı — BM_EXPORT_DIR doğru mu? (manifest.json içeren dizin olmalı)',
  );
  process.exit(1);
}

if (write) {
  logger.error(
    'Gerçek import henüz bağlanmadı: Postgres olmadan yazılamaz ve test edilemez. ' +
      'Panel konteyneri hazır olunca eklenecek. Şimdilik --dry-run kullanın.',
  );
  process.exit(1);
}

const report = await analyzeArchive(dir);
process.stdout.write(`\n${report.lines.join('\n')}\n`);
process.exit(report.blocking ? 1 : 0);
