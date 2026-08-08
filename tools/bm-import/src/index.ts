import { createDb } from '@altai/db';
import { logger } from '@altai/shared';
import { analyzeArchive } from './analyze.js';
import { countTables, runImport } from './import.js';
import { fileExists } from './ndjson.js';

/**
 * BM arşivi -> Postgres ETL — plan Bölüm 5.5-A/2 ve /3.
 *
 * İki mod:
 *   (varsayılan)  Kuru koşu. Veritabanına dokunmaz, arşivi okur ve ETL'in ne
 *                 yapacağını + veride hangi sorunların olduğunu raporlar.
 *                 Postgres GEREKTİRMEZ.
 *   --write       Gerçek import. DATABASE_URL ve BM_SERVER_MAP ister.
 *
 * Kullanım:
 *   pnpm bm:analyze
 *   BM_SERVER_MAP=27133078:squad-01,28022344:squad-02 pnpm bm:import -- --write
 */

const args = process.argv.slice(2).filter((a) => a !== '--');
const write = args.includes('--write');
const dir = process.env.BM_EXPORT_DIR ?? './bm-archive';

if (!fileExists(`${dir}/manifest.json`)) {
  logger.error(
    { dir },
    'arşiv bulunamadı — BM_EXPORT_DIR doğru mu? (manifest.json içeren dizin olmalı)',
  );
  process.exit(1);
}

if (!write) {
  const report = await analyzeArchive(dir);
  process.stdout.write(`\n${report.lines.join('\n')}\n`);
  process.exit(report.blocking ? 1 : 0);
}

// ------------------------------------------------------------ gerçek import
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  logger.error('DATABASE_URL tanımlı değil');
  process.exit(1);
}

// BM sunucu id'leri ile bizim slug'larımız arasındaki eşleme. Bilinçli olarak
// zorunlu ve açık: yanlış eşleme, 400 bin session'ı yanlış sunucuya yazmak
// demek ve geri almak çok pahalı.
const rawMap = process.env.BM_SERVER_MAP ?? '';
const serverMap = new Map<string, string>();
for (const pair of rawMap
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)) {
  const [bmId, slug] = pair.split(':').map((s) => s.trim());
  if (bmId && slug) serverMap.set(bmId, slug);
}
if (serverMap.size === 0) {
  logger.error(
    'BM_SERVER_MAP tanımlı değil. Örnek: BM_SERVER_MAP=27133078:squad-01,28022344:squad-02',
  );
  process.exit(1);
}

logger.info({ dir, eslesme: Object.fromEntries(serverMap) }, 'import başlıyor');
const db = createDb(databaseUrl);

const before = await countTables(db);
const started = Date.now();
const summary = await runImport({ db, dir, serverMap });
const after = await countTables(db);
const minutes = ((Date.now() - started) / 60_000).toFixed(1);

const lines: string[] = [];
lines.push('');
lines.push(`Import tamamlandı — ${minutes} dakika`);
lines.push('');
lines.push(
  `${'tablo'.padEnd(20)} ${'önce'.padStart(10)} ${'sonra'.padStart(10)} ${'eklenen'.padStart(10)}`,
);
lines.push('-'.repeat(54));
for (const table of Object.keys(after)) {
  const b = before[table] ?? 0;
  const a = after[table] ?? 0;
  lines.push(
    `${table.padEnd(20)} ${b.toLocaleString('tr-TR').padStart(10)} ` +
      `${a.toLocaleString('tr-TR').padStart(10)} ${(a - b).toLocaleString('tr-TR').padStart(10)}`,
  );
}
lines.push('');
lines.push('İşlenen kayıt (arşivden):');
for (const [k, v] of Object.entries(summary)) {
  lines.push(`  ${k.padEnd(20)} ${v.toLocaleString('tr-TR')}`);
}
lines.push('');
lines.push('SONRAKİ ADIM: bu sayıları BM panelindekilerle karşılaştırın (plan 5.5-A/3).');
lines.push('Import tekrar çalıştırılabilir — aynı kayıtlar ikilenmez.');

process.stdout.write(`${lines.join('\n')}\n`);
process.exit(0);
