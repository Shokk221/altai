import { createWriteStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@altai/shared';
import type { Archive } from './archive.js';
import { type BmClient, BmHttpError } from './bm-client.js';
import { readResourceIds } from './export-list.js';
import type { PerPlayerResource } from './resources.js';

/**
 * Oyuncu başına kaynak çekimi (notlar, flag atamaları).
 *
 * BM'de bu ikisinin org geneli listeleme ucu yok — her oyuncu için ayrı bir
 * istek gerekir. Yani bu faz, arşivin en uzun süren parçası: N oyuncu × 2
 * istek. 50.000 oyuncu ve 4 istek/sn ile ~7 saat. Bu yüzden:
 *  - devam edilebilir (tamamlanan her oyuncu ID'si .done dosyasına yazılır)
 *  - paralel işçilerle çalışır (hepsi aynı rate limiter'ı paylaşır)
 *  - ilerleme düzenli olarak loglanır, süreç her an kesilebilir
 */

export interface PerPlayerOptions {
  client: BmClient;
  archive: Archive;
  resource: PerPlayerResource;
  concurrency: number;
  /**
   * Sorulacak oyuncular. Verilmezse players.ndjson'daki HERKES sorulur
   * (tam kapsam, saatler sürer). Daraltılmış aday listesi için
   * readNoteCandidates() — bkz. flag-assignments.ts.
   */
  playerIds?: string[];
  /** Test/deneme için: sadece ilk N oyuncuyu işle. */
  limit?: number;
}

function donePath(archive: Archive, name: string): string {
  return path.join(archive.dir, `${name}.done`);
}

async function loadDone(filePath: string): Promise<Set<string>> {
  const done = new Set<string>();
  if (!existsSync(filePath)) return done;
  const content = await readFile(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const id = line.trim();
    if (id) done.add(id);
  }
  return done;
}

export async function exportPerPlayer(opts: PerPlayerOptions): Promise<number> {
  const { client, archive, resource } = opts;
  const name = resource.name;

  if (archive.isDone(name)) {
    logger.info({ resource: name }, 'zaten tamamlanmış — atlanıyor');
    return archive.resource(name).records;
  }

  const playerIds = opts.playerIds ?? (await readResourceIds(archive.dataPath('players')));
  if (playerIds.length === 0) {
    throw new Error(
      `${name} için oyuncu listesi gerekli ama boş geldi. Önce players kaynağını çekin.`,
    );
  }

  const doneFile = donePath(archive, name);
  const done = await loadDone(doneFile);
  const pending = playerIds.filter((id) => !done.has(id));
  const targets = opts.limit ? pending.slice(0, opts.limit) : pending;

  logger.info(
    { resource: name, toplam: playerIds.length, tamamlanan: done.size, kalan: targets.length },
    'oyuncu başına çekim başlıyor',
  );

  if (targets.length === 0) {
    await archive.markDone(name);
    return archive.resource(name).records;
  }

  await archive.markRunning(name);
  const doneStream = createWriteStream(doneFile, { flags: 'a' });

  let processed = 0;
  let accessDenied = false;
  let failure: unknown = null;
  const startedAt = Date.now();

  // Basit iş kuyruğu: her işçi sıradaki oyuncuyu alır. Rate limiter client'ta
  // ve paylaşımlı olduğu için işçi sayısı toplam hızı değil, gecikme
  // toleransını artırır (ağ gidiş-dönüşü limitin altında kalmasın diye).
  let cursor = 0;
  const nextIndex = () => (cursor < targets.length ? cursor++ : -1);

  const worker = async () => {
    for (;;) {
      if (failure || accessDenied) return;
      const index = nextIndex();
      if (index === -1) return;
      const playerId = targets[index];
      if (!playerId) return;

      try {
        // Bir oyuncunun notları/flag'leri nadiren 100'ü aşar ama sayfalamayı
        // yine de takip ediyoruz — sessizce veri kaybetmektense fazladan istek.
        for await (const page of client.paginate(resource.path(playerId), resource.params)) {
          // Hangi oyuncuya ait olduğu ilişkilerde var, ama ETL'in tek satıra
          // bakarak çalışabilmesi için açıkça damgalıyoruz.
          const stamped = page.data.map((item) => ({ ...item, _playerId: playerId }));
          await archive.writePage(name, stamped, page.included, null);
        }
        doneStream.write(`${playerId}\n`);
        processed++;

        if (processed % 250 === 0) {
          const elapsedMin = (Date.now() - startedAt) / 60_000;
          const rate = processed / Math.max(elapsedMin, 0.01);
          const etaMin = Math.round((targets.length - processed) / Math.max(rate, 0.01));
          logger.info(
            {
              resource: name,
              islenen: processed,
              kalan: targets.length - processed,
              kayit: archive.resource(name).records,
              tahminiDakika: etaMin,
            },
            'ilerleme',
          );
        }
      } catch (error) {
        if (error instanceof BmHttpError && [401, 403].includes(error.status)) {
          // Yetki yok — her oyuncu için tekrar denemek anlamsız, fazı durdur.
          accessDenied = true;
          logger.warn(
            { resource: name, status: error.status },
            'bu uç token/plan tarafından desteklenmiyor — faz atlanıyor',
          );
          return;
        }
        if (error instanceof BmHttpError && error.status === 404) {
          // Oyuncu silinmiş/erişilemiyor — tamamlandı say, arşiv durmasın.
          doneStream.write(`${playerId}\n`);
          processed++;
          continue;
        }
        failure = error;
        return;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: opts.concurrency }, worker));
  } finally {
    await new Promise<void>((resolve) => doneStream.end(resolve));
  }

  if (failure) {
    await archive.markFailed(name, failure);
    throw failure;
  }
  if (accessDenied) {
    await archive.markFailed(name, new Error('401/403 — uç erişime kapalı'), 'unsupported');
    return archive.resource(name).records;
  }

  // limit ile çalıştıysak kaynak bitmiş sayılmaz.
  if (opts.limit && pending.length > targets.length) {
    logger.warn(
      { resource: name, kalan: pending.length - targets.length },
      '--limit nedeniyle kaynak yarım bırakıldı, "done" işaretlenmedi',
    );
    return archive.resource(name).records;
  }

  await archive.markDone(name);
  const total = archive.resource(name).records;
  logger.info({ resource: name, oyuncu: processed, kayit: total }, 'oyuncu başına çekim bitti');
  return total;
}
