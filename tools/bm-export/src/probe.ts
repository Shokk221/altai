import { type BmClient, BmHttpError } from './bm-client.js';
import {
  type ExportContext,
  LIST_RESOURCES,
  PER_PLAYER_RESOURCES,
  SERVER_HISTORY_RESOURCES,
  SERVER_LIST_RESOURCES,
} from './resources.js';

/**
 * --probe: tam çekime girişmeden önce her ucu 1 kayıtlık istekle yoklar.
 *
 * Neden gerekli: BM'nin API yüzeyi abonelik planına ve org yetkilerine göre
 * değişiyor; bir ucun kapalı olduğunu 6 saatlik bir çekimin ortasında
 * öğrenmek yerine 20 saniyede öğrenmek istiyoruz. Ayrıca dönen kayıt sayısı,
 * filtrenin gerçekten uygulanıp uygulanmadığını gözle kontrol etmeyi sağlar.
 */

export interface ProbeResult {
  name: string;
  path: string;
  ok: boolean;
  status: number | 'OK' | 'HATA';
  sample: number;
  hasNextPage: boolean;
  critical: boolean;
  purpose: string;
  note: string;
}

async function probeOne(
  client: BmClient,
  name: string,
  path: string,
  params: Record<string, string>,
  critical: boolean,
  purpose: string,
  /**
   * Geçmiş uçları (player-count-history vb.) sayfalanmaz ve şemaları katıdır:
   * page[size] eklemek "must NOT have additional properties" ile 400 döndürür.
   */
  paged = true,
): Promise<ProbeResult> {
  try {
    const page = await client.get(path, paged ? { ...params, 'page[size]': '1' } : params);
    return {
      name,
      path,
      ok: true,
      status: 'OK',
      sample: page.data.length,
      hasNextPage: page.nextUrl !== null,
      critical,
      purpose,
      note: page.data.length === 0 ? 'uç çalışıyor ama kayıt dönmedi' : '',
    };
  } catch (error) {
    const status = error instanceof BmHttpError ? error.status : 'HATA';
    const note = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error);
    return {
      name,
      path,
      ok: false,
      status,
      sample: 0,
      hasNextPage: false,
      critical,
      purpose,
      note,
    };
  }
}

export async function probeAll(
  client: BmClient,
  ctx: ExportContext,
  samplePlayerId?: string,
): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];

  for (const resource of LIST_RESOURCES) {
    results.push(
      await probeOne(
        client,
        resource.name,
        resource.path,
        resource.params(ctx),
        resource.critical,
        resource.purpose,
      ),
    );
  }

  const serverId = ctx.serverIds[0];
  if (serverId) {
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    for (const resource of SERVER_HISTORY_RESOURCES) {
      results.push(
        await probeOne(
          client,
          resource.name,
          resource.path(serverId),
          {
            start: monthAgo.toISOString(),
            stop: now.toISOString(),
            ...resource.extraParams,
          },
          resource.critical,
          resource.purpose,
          false,
        ),
      );
    }
    for (const resource of SERVER_LIST_RESOURCES) {
      results.push(
        await probeOne(
          client,
          resource.name,
          resource.path(serverId),
          resource.params,
          resource.critical,
          resource.purpose,
        ),
      );
    }
  }

  if (samplePlayerId) {
    for (const resource of PER_PLAYER_RESOURCES) {
      results.push(
        await probeOne(
          client,
          resource.name,
          resource.path(samplePlayerId),
          resource.params,
          resource.critical,
          resource.purpose,
        ),
      );
    }
  } else {
    for (const resource of PER_PLAYER_RESOURCES) {
      results.push({
        name: resource.name,
        path: resource.path('<playerId>'),
        ok: false,
        status: 'HATA',
        sample: 0,
        hasNextPage: false,
        critical: resource.critical,
        purpose: resource.purpose,
        note: "örnek oyuncu ID'si yok — önce players kaynağını çekin",
      });
    }
  }

  return results;
}

export function formatProbeTable(results: ProbeResult[]): string {
  const rows = results.map((r) => ({
    kaynak: r.name,
    durum: r.ok ? `✓ ${r.status}` : `✗ ${r.status}`,
    kritik: r.critical ? 'EVET' : '',
    ornek: String(r.sample),
    devami: r.hasNextPage ? 'var' : '-',
    not: r.note.slice(0, 60),
  }));

  const headers = ['kaynak', 'durum', 'kritik', 'ornek', 'devami', 'not'] as const;
  const widths = headers.map((h) => Math.max(h.length, ...rows.map((row) => row[h].length)));

  const line = (cells: readonly string[]) =>
    cells.map((cell, i) => cell.padEnd(widths[i] ?? cell.length)).join('  ');

  const out = [line(headers), line(widths.map((w) => '-'.repeat(w)))];
  for (const row of rows) out.push(line(headers.map((h) => row[h])));

  const brokenCritical = results.filter((r) => r.critical && !r.ok);
  if (brokenCritical.length > 0) {
    out.push('');
    const names = brokenCritical.map((r) => r.name).join(', ');
    out.push(`UYARI: ${brokenCritical.length} KRİTİK kaynak erişilemiyor — ${names}.`);
    out.push('BM aboneliğini iptal etmeden önce bunlar çözülmeli.');
  }
  return out.join('\n');
}
