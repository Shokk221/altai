import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { logger } from '@altai/shared';
import type { Archive } from './archive.js';
import { type BmClient, BmHttpError } from './bm-client.js';
import type { ExportContext } from './resources.js';

/**
 * Flag atamaları — "hangi oyuncuda hangi flag var" (SL banları burada).
 *
 * Bariz yol, her oyuncu için /players/{id}/relationships/flags çağırmaktı:
 * 200.000 oyuncu × 1 istek = 300 istek/dk limitiyle ~11 saat.
 *
 * Bunun yerine tersten gidiyoruz: /players?filter[playerFlags]=<flagId>
 * belirli bir flag'i taşıyan oyuncuları döndürüyor, include=flagPlayer ise
 * atama kaydının kendisini (addedAt, removedAt, ekleyen admin) veriyor.
 * Flag sayısı kadar tarama yetiyor — 14 flag, ~2 dakika, veri kaybı sıfır.
 */

export interface FlagAssignmentOptions {
  client: BmClient;
  archive: Archive;
  ctx: ExportContext;
}

const RESOURCE = 'player-flag-assignments';

export async function exportFlagAssignments(opts: FlagAssignmentOptions): Promise<number> {
  const { client, archive, ctx } = opts;

  if (archive.isDone(RESOURCE)) {
    logger.info({ resource: RESOURCE }, 'zaten tamamlanmış — atlanıyor');
    return archive.resource(RESOURCE).records;
  }

  const flagIds = await readFlagIds(archive.dataPath('player-flags'));
  if (flagIds.length === 0) {
    throw new Error(
      [
        `${RESOURCE} için flag tanımları gerekli ama player-flags.ndjson boş.`,
        'Önce `--only player-flags` çalıştırın.',
      ].join(' '),
    );
  }

  await archive.markRunning(RESOURCE);
  logger.info({ resource: RESOURCE, flag: flagIds.length }, 'flag atamaları çekiliyor');

  // BM, bir flag'e göre filtrelenmiş oyuncu listesinde o oyuncunun DİĞER
  // flag atamalarını da included'a koyuyor. Yani aynı atama, oyuncunun her
  // flag'i taranırken tekrar geliyor. Tekilleştirmezsek arşivde binlerce
  // kopya olur (ilk çekimde 11.433 satırın 3.393'ü kopyaydı).
  const seen = new Set<string>();

  try {
    for (const flagId of flagIds) {
      let count = 0;
      for await (const page of client.paginate('/players', {
        'page[size]': '100',
        'filter[servers]': ctx.serverIds.join(','),
        'filter[playerFlags]': flagId,
        include: 'flagPlayer,playerFlag',
      })) {
        // Asıl istediğimiz kayıt data'da değil included'da: flagPlayer,
        // yani atamanın kendisi. Oyuncu kaydı zaten players.ndjson'da var.
        const assignments = page.included.filter(
          (item) => item.type === 'flagPlayer' && !seen.has(item.id),
        );
        for (const item of assignments) seen.add(item.id);
        await archive.writePage(RESOURCE, assignments, [], null);
        count += assignments.length;
      }
      logger.info({ flagId, atama: count }, 'flag tarandı');
    }

    await archive.markDone(RESOURCE);
  } catch (error) {
    if (error instanceof BmHttpError && [400, 401, 403, 404].includes(error.status)) {
      logger.warn({ resource: RESOURCE, status: error.status }, 'uç desteklenmiyor — atlanıyor');
      await archive.markFailed(RESOURCE, error, 'unsupported');
      return archive.resource(RESOURCE).records;
    }
    await archive.markFailed(RESOURCE, error);
    throw error;
  }

  const total = archive.resource(RESOURCE).records;
  logger.info({ resource: RESOURCE, total }, 'flag atamaları tamamlandı');
  return total;
}

async function readFlagIds(filePath: string): Promise<string[]> {
  if (!existsSync(filePath)) return [];
  const content = await readFile(filePath, 'utf8');
  const ids: string[] = [];
  for (const line of content.split('\n')) {
    if (!line) continue;
    try {
      const item = JSON.parse(line) as { id?: string; type?: string };
      if (item.type === 'playerFlag' && item.id) ids.push(item.id);
    } catch {
      // yarım satır — yok say
    }
  }
  return ids;
}

/**
 * Notların çekileceği aday oyuncu kümesi: flag'i olan ∪ banı olan oyuncular.
 *
 * Notların org geneli listeleme ucu YOK ve /players üzerinde not filtresi de
 * yok (denendi: filter[playerNotes]/[hasNotes]/[notes] hepsi 400). Yani tam
 * kapsam için tek yol her oyuncuyu tek tek sormak — 200.000 oyuncu, ~11 saat.
 *
 * Aday kümesi bunu dakikalara indiriyor: admin bir oyuncuya not yazdıysa
 * neredeyse her zaman ona flag de takmış ya da ban da atmıştır. Yine de bu
 * bir HEURİSTİK — hiçbir işlem görmemiş bir oyuncuya yazılmış tek başına bir
 * not bu kümeye girmez. Tam kapsam isteniyorsa `--notes-scope all`.
 */
export async function readNoteCandidates(archive: Archive): Promise<string[]> {
  const candidates = new Set<string>();

  await collectRelatedPlayerIds(archive.dataPath(RESOURCE), candidates);
  await collectRelatedPlayerIds(archive.dataPath('bans'), candidates);

  return [...candidates];
}

/** JSON:API kayıtlarının relationships.player.data.id alanlarını toplar. */
async function collectRelatedPlayerIds(filePath: string, into: Set<string>): Promise<void> {
  if (!existsSync(filePath)) return;
  const content = await readFile(filePath, 'utf8');
  for (const line of content.split('\n')) {
    if (!line) continue;
    try {
      const item = JSON.parse(line) as {
        relationships?: { player?: { data?: { id?: string } } };
      };
      const id = item.relationships?.player?.data?.id;
      if (id) into.add(id);
    } catch {
      // yarım satır — yok say
    }
  }
}
