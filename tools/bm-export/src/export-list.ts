import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { logger } from '@altai/shared';
import type { Archive } from './archive.js';
import { type BmClient, BmHttpError } from './bm-client.js';

/** Token'ın bu uca erişimi yok — arşiv durmaz, kaynak "unsupported" işaretlenir. */
function isAccessError(error: unknown): error is BmHttpError {
  return error instanceof BmHttpError && [401, 403, 404, 400].includes(error.status);
}

export interface ListExportOptions {
  name: string;
  path: string;
  params: Record<string, string>;
  client: BmClient;
  archive: Archive;
  /** Bu kaynak eksik kalırsa geçiş durmalı mı (rapora yansır). */
  critical: boolean;
}

/**
 * Sayfalanan bir kaynağı baştan sona (veya manifest'teki cursor'dan devam
 * ederek) NDJSON'a yazar. Her sayfa yazıldıktan sonra cursor kaydedilir,
 * yani süreç her an öldürülebilir.
 */
export async function exportList(opts: ListExportOptions): Promise<number> {
  const { name, client, archive } = opts;

  if (archive.isDone(name)) {
    logger.info({ resource: name }, 'zaten tamamlanmış — atlanıyor (yeniden çekim: --reset)');
    return archive.resource(name).records;
  }

  const state = archive.resource(name);
  const resumeUrl = state.cursor;
  if (resumeUrl) {
    logger.info({ resource: name, records: state.records }, 'kaldığı yerden devam ediliyor');
  }

  await archive.markRunning(name);
  let pageNo = 0;

  try {
    for await (const page of client.paginate(opts.path, opts.params, resumeUrl)) {
      await archive.writePage(name, page.data, page.included, page.nextUrl);
      pageNo++;
      if (pageNo % 10 === 0 || !page.nextUrl) {
        logger.info(
          { resource: name, pages: pageNo, records: archive.resource(name).records },
          'ilerleme',
        );
      }
    }
    await archive.markDone(name);
    const total = archive.resource(name).records;
    logger.info({ resource: name, total }, 'kaynak tamamlandı');
    return total;
  } catch (error) {
    if (isAccessError(error)) {
      logger.warn(
        { resource: name, status: error.status },
        'bu uç token/plan tarafından desteklenmiyor — atlanıyor',
      );
      await archive.markFailed(name, error, 'unsupported');
      return archive.resource(name).records;
    }
    await archive.markFailed(name, error);
    throw error;
  }
}

/**
 * Sunucu listesini belirler ve ID'lerini manifest'e yazar. Diğer her şey
 * (players, sessions, history) bu ID'lere bağlı olduğu için ilk adım budur —
 * ve filter[servers] olmadan /players TÜM BM oyuncu veritabanını taramaya kalkar.
 *
 * İki yol var ve açık ara tercih edileni birincisi:
 *  1. BM_SERVER_IDS ile açıkça verilir (BM panelindeki sunucu URL'sinden
 *     okunur: battlemetrics.com/servers/squad/<ID>). Kesin, doğrulanabilir.
 *  2. Verilmezse /servers?filter[organizations]= ile keşfedilir. Bu filtre
 *     gerçek API'ye karşı doğrulandı ve org'un sunucularını doğru döndürüyor,
 *     ama BM dokümantasyonunda yer almadığı için dönen liste yine de log'a
 *     basılıp gözle onaylanması isteniyor.
 */
export async function resolveServers(
  client: BmClient,
  archive: Archive,
  explicitIds: string[],
): Promise<string[]> {
  const organizationId = archive.state.organizationId;

  if (explicitIds.length > 0) {
    // Her sunucunun meta verisini de arşivle (isim, oyun, port, org).
    if (!archive.isDone('servers')) {
      await archive.markRunning('servers');
      for (const id of explicitIds) {
        const page = await client.get(`/servers/${id}`, { include: 'organization' });
        await archive.writePage('servers', page.data, page.included, null);
      }
      await archive.markDone('servers');
    }
    await archive.setServerIds(explicitIds);
    logger.info({ organizationId, servers: explicitIds }, 'sunucular BM_SERVER_IDS ile verildi');
    return explicitIds;
  }

  logger.info('BM_SERVER_IDS verilmedi — sunucular org filtresiyle keşfedilecek.');

  await exportList({
    name: 'servers',
    path: '/servers',
    params: {
      'page[size]': '100',
      'filter[organizations]': organizationId,
      include: 'organization',
    },
    client,
    archive,
    critical: true,
  });

  const ids = await readResourceIds(archive.dataPath('servers'));
  if (ids.length === 0) {
    throw new Error(
      [
        `Org ${organizationId} için hiç sunucu bulunamadı.`,
        "BM_ORGANIZATION_ID doğru mu, token bu org'a erişebiliyor mu?",
        'Kesin çözüm: BM_SERVER_IDS=<id1>,<id2> verin.',
      ].join(' '),
    );
  }

  const names = await readServerNames(archive.dataPath('servers'));
  logger.info({ servers: names }, 'keşfedilen sunucular — BUNLAR SİZİN SUNUCULARINIZ MI?');
  await archive.setServerIds(ids);
  return ids;
}

/** NDJSON dosyasındaki JSON:API kaynaklarının id alanlarını okur. */
export async function readResourceIds(filePath: string): Promise<string[]> {
  if (!existsSync(filePath)) return [];

  const ids: string[] = [];
  const seen = new Set<string>();
  const content = await readFile(filePath, 'utf8');
  for (const line of content.split('\n')) {
    if (!line) continue;
    try {
      const item = JSON.parse(line) as { id?: string };
      if (item.id && !seen.has(item.id)) {
        seen.add(item.id);
        ids.push(item.id);
      }
    } catch {
      // Çökme anında yarım kalmış satır — yok say.
    }
  }
  return ids;
}

/** Keşfedilen sunucuları "id — isim" olarak döndürür (gözle doğrulama için). */
async function readServerNames(filePath: string): Promise<string[]> {
  if (!existsSync(filePath)) return [];
  const content = await readFile(filePath, 'utf8');
  const out: string[] = [];
  for (const line of content.split('\n')) {
    if (!line) continue;
    try {
      const item = JSON.parse(line) as { id?: string; attributes?: { name?: string } };
      out.push(`${item.id} — ${item.attributes?.name ?? '(isimsiz)'}`);
    } catch {
      // yok say
    }
  }
  return out;
}
