import { createReadStream, existsSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';

/**
 * NDJSON akış okuyucu.
 *
 * Arşivin en büyük dosyası 606 MB (players.included.ndjson) — readFile ile
 * belleğe almak Node'un string sınırına dayanır ve zaten gereksiz. Satır
 * satır okuyup hemen işliyoruz.
 */
export async function* readNdjson<T>(filePath: string): AsyncGenerator<T> {
  if (!existsSync(filePath)) return;

  const stream = createReadStream(filePath, { encoding: 'utf8' });
  // crlfDelay: Windows'ta üretilmiş dosyalarda \r\n tek satır sonu sayılsın.
  const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  for await (const line of lines) {
    if (!line) continue;
    try {
      yield JSON.parse(line) as T;
    } catch {
      // Çekim sırasında süreç öldüyse son satır yarım kalmış olabilir.
      // Arşivleyici bunu zaten cursor ile toparlıyor; burada atlamak doğru.
    }
  }
}

export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

export function fileSizeMb(filePath: string): number {
  try {
    return statSync(filePath).size / (1024 * 1024);
  } catch {
    return 0;
  }
}

/** BM JSON:API kaynağının ortak iskeleti. */
export interface BmRecord {
  type: string;
  id: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id?: string } | { id?: string }[] }>;
  meta?: Record<string, unknown>;
}

/** relationships.<name>.data.id — tekil ilişki. */
export function relId(record: BmRecord, name: string): string | undefined {
  const data = record.relationships?.[name]?.data;
  if (!data || Array.isArray(data)) return undefined;
  return data.id;
}
