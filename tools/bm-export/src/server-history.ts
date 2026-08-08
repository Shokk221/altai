import { logger } from '@altai/shared';
import type { Archive } from './archive.js';
import { type BmClient, BmHttpError } from './bm-client.js';
import { exportList } from './export-list.js';
import type { ServerHistoryResource, ServerListResource } from './resources.js';

/**
 * Sunucu geçmişi uçları start/stop zorunlu tutuyor ve uzun aralıklarda ya
 * kırpılıyor ya da zaman aşımına uğruyor. Bu yüzden aralık ay ay parçalanır;
 * her ay ayrı bir istek, sonuçlar aynı NDJSON'a eklenir.
 */
function monthlyWindows(from: Date, to: Date): Array<{ start: string; stop: string }> {
  const windows: Array<{ start: string; stop: string }> = [];
  // İlk pencere TAM olarak `from`'da başlar. Ay başına yuvarlamak, 90 günlük
  // sınıra kırpılmış bir başlangıcı tekrar sınırın dışına taşır (2026-05-10 ->
  // 2026-05-01 = 99 gün önce) ve BM 400 döner.
  let cursor = from;

  while (cursor < to) {
    const next = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const stop = next < to ? next : to;
    windows.push({ start: cursor.toISOString(), stop: stop.toISOString() });
    cursor = next;
  }
  return windows;
}

export interface ServerHistoryOptions {
  client: BmClient;
  archive: Archive;
  serverIds: string[];
  resource: ServerHistoryResource;
  /** Arşivin başlangıç tarihi — sunucular bundan önce yoktu. */
  historyStart: Date;
  /**
   * BM bu uçlarda geçmişe sınır koyuyor: "Start may not be more than 90 days
   * ago" (400). Daha eskisi API'den ALINAMIYOR — abonelik dururken bile.
   * İstenen başlangıç bu sınırdan eskiyse sınıra kırpılır ve uyarılır.
   */
  maxDaysBack: number;
}

export async function exportServerHistory(opts: ServerHistoryOptions): Promise<number> {
  const { client, archive, resource } = opts;
  const name = resource.name;

  if (archive.isDone(name)) {
    logger.info({ resource: name }, 'zaten tamamlanmış — atlanıyor');
    return archive.resource(name).records;
  }

  await archive.markRunning(name);

  const now = new Date();
  // 1 saat pay: pencerenin başı istek anında sınırın dışına kaymasın.
  const earliest = new Date(now.getTime() - opts.maxDaysBack * 86_400_000 + 3_600_000);
  let start = opts.historyStart;
  if (start < earliest) {
    logger.warn(
      {
        resource: name,
        istenen: opts.historyStart.toISOString().slice(0, 10),
        alinabilen: earliest.toISOString().slice(0, 10),
      },
      `BM bu uçta ${opts.maxDaysBack} günden eskisini vermiyor — başlangıç kırpıldı`,
    );
    start = earliest;
  }

  const windows = monthlyWindows(start, now);
  const totalCalls = windows.length * opts.serverIds.length;
  logger.info({ resource: name, aylar: windows.length, istek: totalCalls }, 'geçmiş çekimi');

  let calls = 0;
  try {
    for (const serverId of opts.serverIds) {
      for (const window of windows) {
        const page = await client.get(resource.path(serverId), {
          start: window.start,
          stop: window.stop,
          ...resource.extraParams,
        });
        // Bu uçlar JSON:API kaynağı değil, düz veri noktası dizisi döndürüyor —
        // hangi sunucu/pencere olduğunu kaybetmemek için damgalanıyor.
        const stamped = page.data.map((point) => ({
          _serverId: serverId,
          _windowStart: window.start,
          ...point,
        }));
        await archive.writeRecords(name, stamped);
        calls++;
        if (calls % 25 === 0) {
          logger.info({ resource: name, istek: `${calls}/${totalCalls}` }, 'ilerleme');
        }
      }
    }
    await archive.markDone(name);
  } catch (error) {
    if (error instanceof BmHttpError && [400, 401, 403, 404].includes(error.status)) {
      logger.warn({ resource: name, status: error.status }, 'uç desteklenmiyor — atlanıyor');
      await archive.markFailed(name, error, 'unsupported');
      return archive.resource(name).records;
    }
    await archive.markFailed(name, error);
    throw error;
  }

  const total = archive.resource(name).records;
  logger.info({ resource: name, total }, 'geçmiş çekimi tamamlandı');
  return total;
}

/**
 * Sunucu başına sayfalanan kaynaklar (outages, leaderboard). Her sunucu ayrı
 * bir alt-kaynak adıyla ("outages@12345") arşivlenir ki biri yarıda kalırsa
 * diğerleri etkilenmesin ve resume tek sunucu bazında çalışsın.
 */
export async function exportServerLists(
  client: BmClient,
  archive: Archive,
  serverIds: string[],
  resource: ServerListResource,
): Promise<number> {
  let total = 0;
  for (const serverId of serverIds) {
    total += await exportList({
      name: `${resource.name}@${serverId}`,
      path: resource.path(serverId),
      params: resource.params,
      client,
      archive,
      critical: resource.critical,
    });
  }
  return total;
}
