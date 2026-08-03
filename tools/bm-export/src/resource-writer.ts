import { existsSync, mkdirSync } from 'node:fs';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@altai/shared';
import { fetchBmResource } from './bm-client.js';

export interface ExportResourceOptions {
  resourceName: string; // players, bans, ...
  bmPath: string; // BM API path, örn. /players
  token: string;
  baseParams?: Record<string, string>;
  outDir: string;
}

function cursorFilePath(outDir: string, resourceName: string) {
  return path.join(outDir, `${resourceName}.cursor`);
}

function dataFilePath(outDir: string, resourceName: string) {
  return path.join(outDir, `${resourceName}.ndjson`);
}

export async function exportBmResource(opts: ExportResourceOptions): Promise<number> {
  mkdirSync(opts.outDir, { recursive: true });

  const cursorPath = cursorFilePath(opts.outDir, opts.resourceName);
  const dataPath = dataFilePath(opts.outDir, opts.resourceName);

  const resumeFromCursor = existsSync(cursorPath)
    ? (await readFile(cursorPath, 'utf8')).trim() || undefined
    : undefined;

  if (resumeFromCursor) {
    logger.info(
      { resource: opts.resourceName, cursor: resumeFromCursor },
      'kaldığı yerden devam ediliyor',
    );
  } else if (!existsSync(dataPath)) {
    await writeFile(dataPath, '');
  }

  const total = await fetchBmResource(
    opts.bmPath,
    opts.token,
    { 'page[size]': '100', ...opts.baseParams },
    async (page, nextCursor) => {
      const lines = page.map((item) => JSON.stringify(item)).join('\n');
      if (lines) await appendFile(dataPath, `${lines}\n`);

      if (nextCursor) {
        await writeFile(cursorPath, nextCursor);
      } else {
        // Bitti — cursor dosyasını sil ki bir sonraki çalıştırma sıfırdan
        // başladığını (kasıtlı bir yeniden çekimse) anlayabilsin.
        if (existsSync(cursorPath)) await writeFile(cursorPath, '');
      }

      logger.info({ resource: opts.resourceName, pageSize: page.length }, 'sayfa yazıldı');
    },
    resumeFromCursor,
  );

  logger.info({ resource: opts.resourceName, total }, 'kaynak tamamlandı');
  return total;
}
