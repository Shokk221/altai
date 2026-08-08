import { type WriteStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '@altai/shared';
import type { BmResource } from './bm-client.js';

export type ResourceStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'unsupported'
  /** --skip ile bilinçli olarak arşivlenmedi. Eksiklik değil, karar. */
  | 'skipped';

export interface ResourceState {
  status: ResourceStatus;
  records: number;
  /**
   * links.next'in yol+sorgu hâli — yarıda kesilirse buradan devam edilir.
   * `| undefined` bilinçli: alanı `delete` etmek yerine undefined atıyoruz,
   * JSON.stringify undefined alanları zaten dosyaya yazmıyor.
   */
  cursor?: string | undefined;
  startedAt?: string | undefined;
  finishedAt?: string | undefined;
  error?: string | undefined;
}

export interface ArchiveManifest {
  /** Arşivin hangi org için çekildiği — ETL'de kaynak doğrulaması yapılır. */
  organizationId: string;
  serverIds: string[];
  createdAt: string;
  updatedAt: string;
  resources: Record<string, ResourceState>;
}

/**
 * Ham arşiv dizini. Her kaynak bir NDJSON dosyası; include= ile gelen yan
 * kaynaklar ayrı bir .included.ndjson'a (type+id ile tekilleştirilerek) yazılır.
 * Durum manifest.json'da tutulur, süreç her an kesilebilir ve kaldığı yerden
 * devam eder — plan Bölüm 5.5-A'nın "yarıda kesilirse kaybolmaz" şartı.
 */
export class Archive {
  private manifest: ArchiveManifest;
  private readonly streams = new Map<string, WriteStream>();
  /**
   * type:id — included tekrarlarını (her sayfada dönen aynı server vb.) eler.
   * Promise saklanır ki paralel işçiler aynı dosyayı iki kez okumasın.
   */
  private readonly seenIncluded = new Map<string, Promise<Set<string>>>();

  private constructor(
    readonly dir: string,
    manifest: ArchiveManifest,
  ) {
    this.manifest = manifest;
  }

  static async open(dir: string, organizationId: string): Promise<Archive> {
    mkdirSync(dir, { recursive: true });
    const manifestPath = path.join(dir, 'manifest.json');
    const now = new Date().toISOString();

    let manifest: ArchiveManifest;
    if (existsSync(manifestPath)) {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ArchiveManifest;
      if (manifest.organizationId !== organizationId) {
        throw new Error(
          `Bu dizin başka bir organizasyonun arşivi (${manifest.organizationId}), ` +
            `istenen: ${organizationId}. Farklı bir BM_EXPORT_DIR kullanın.`,
        );
      }
    } else {
      manifest = { organizationId, serverIds: [], createdAt: now, updatedAt: now, resources: {} };
    }

    return new Archive(dir, manifest);
  }

  get state(): Readonly<ArchiveManifest> {
    return this.manifest;
  }

  resource(name: string): ResourceState {
    const existing = this.manifest.resources[name];
    if (existing) return existing;
    const fresh: ResourceState = { status: 'pending', records: 0 };
    this.manifest.resources[name] = fresh;
    return fresh;
  }

  isDone(name: string): boolean {
    return this.manifest.resources[name]?.status === 'done';
  }

  async setServerIds(ids: string[]): Promise<void> {
    this.manifest.serverIds = ids;
    await this.saveManifest();
  }

  async markRunning(name: string): Promise<void> {
    const state = this.resource(name);
    state.status = 'running';
    state.startedAt ??= new Date().toISOString();
    state.error = undefined;
    await this.saveManifest();
  }

  async markDone(name: string): Promise<void> {
    const state = this.resource(name);
    state.status = 'done';
    state.finishedAt = new Date().toISOString();
    state.cursor = undefined;
    state.error = undefined;
    await this.saveManifest();
  }

  async markFailed(name: string, error: unknown, status: ResourceStatus = 'failed'): Promise<void> {
    const state = this.resource(name);
    state.status = status;
    state.error = error instanceof Error ? error.message : String(error);
    await this.saveManifest();
  }

  /**
   * Kaynağı "bilinçli atlandı" olarak işaretler. Zaten çekilmiş bir kaynağı
   * bozmaz — sadece hiç başlanmamış olanlara uygulanır.
   */
  async markSkipped(name: string, reason: string): Promise<void> {
    const state = this.resource(name);
    if (state.status === 'done' || state.records > 0) return;
    state.status = 'skipped';
    state.error = reason;
    await this.saveManifest();
  }

  /** Yeniden çekim için kaynağın durumunu sıfırlar (veri dosyası da silinir). */
  async reset(name: string): Promise<void> {
    await this.closeStream(this.dataPath(name));
    await this.closeStream(this.includedPath(name));
    for (const p of [this.dataPath(name), this.includedPath(name)]) {
      if (existsSync(p)) await writeFile(p, '');
    }
    this.manifest.resources[name] = { status: 'pending', records: 0 };
    this.seenIncluded.delete(name);
    await this.saveManifest();
  }

  dataPath(name: string): string {
    return path.join(this.dir, `${name}.ndjson`);
  }

  includedPath(name: string): string {
    return path.join(this.dir, `${name}.included.ndjson`);
  }

  /**
   * Bir sayfayı diske yazar ve cursor'ı manifest'e işler.
   * Sıra önemli: önce veri fsync'lenecek şekilde stream'e yazılır, sonra
   * cursor kaydedilir — tersi olsaydı çökme anında yazılmamış sayfa
   * "yazılmış" sayılıp atlanırdı.
   */
  async writePage(
    name: string,
    data: BmResource[],
    included: BmResource[],
    nextCursor: string | null,
  ): Promise<void> {
    if (data.length > 0) {
      await this.appendLines(
        this.dataPath(name),
        data.map((item) => JSON.stringify(item)),
      );
    }

    if (included.length > 0) {
      const seen = await this.includedKeys(name);
      const fresh: string[] = [];
      for (const item of included) {
        const key = `${item.type}:${item.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fresh.push(JSON.stringify(item));
      }
      if (fresh.length > 0) await this.appendLines(this.includedPath(name), fresh);
    }

    const state = this.resource(name);
    state.records += data.length;
    if (nextCursor) state.cursor = nextCursor;
    else state.cursor = undefined;
    await this.saveManifest();
  }

  /** Sayfalama yapmayan uçlar (time-series) için tek seferlik satır yazımı. */
  async writeRecords(name: string, records: unknown[]): Promise<void> {
    if (records.length === 0) return;
    await this.appendLines(
      this.dataPath(name),
      records.map((r) => JSON.stringify(r)),
    );
    this.resource(name).records += records.length;
    await this.saveManifest();
  }

  /**
   * Bu kaynak için daha önce yazılmış included anahtarları. Resume'da dosya
   * bir kez okunur — yoksa her yeniden başlatma aynı server/flag kayıtlarını
   * baştan ekler ve dosya şişerdi.
   */
  private includedKeys(name: string): Promise<Set<string>> {
    const cached = this.seenIncluded.get(name);
    if (cached) return cached;

    const load = (async () => {
      const seen = new Set<string>();
      const filePath = this.includedPath(name);
      if (existsSync(filePath)) {
        const content = await readFile(filePath, 'utf8');
        for (const line of content.split('\n')) {
          if (!line) continue;
          try {
            const item = JSON.parse(line) as BmResource;
            seen.add(`${item.type}:${item.id}`);
          } catch {
            // Çökme anında yarım kalmış son satır — yok say, üzerine yazılacak.
          }
        }
      }
      return seen;
    })();

    this.seenIncluded.set(name, load);
    return load;
  }

  private async appendLines(filePath: string, lines: string[]): Promise<void> {
    const stream = this.streamFor(filePath);
    const chunk = `${lines.join('\n')}\n`;
    if (!stream.write(chunk)) {
      await new Promise<void>((resolve) => stream.once('drain', resolve));
    }
  }

  private streamFor(filePath: string): WriteStream {
    let stream = this.streams.get(filePath);
    if (!stream) {
      stream = createWriteStream(filePath, { flags: 'a' });
      this.streams.set(filePath, stream);
    }
    return stream;
  }

  private async closeStream(filePath: string): Promise<void> {
    const stream = this.streams.get(filePath);
    if (!stream) return;
    this.streams.delete(filePath);
    await new Promise<void>((resolve) => stream.end(resolve));
  }

  /**
   * Manifest yazımı sıraya sokulur. Oyuncu başına faz paralel işçilerle
   * çalışıyor; iki işçi aynı anda .tmp'ye yazıp rename etseydi manifest
   * bozulurdu.
   */
  private saveQueue: Promise<void> = Promise.resolve();

  private saveManifest(): Promise<void> {
    const task = async () => {
      this.manifest.updatedAt = new Date().toISOString();
      const target = path.join(this.dir, 'manifest.json');
      const tmp = `${target}.tmp`;
      // Atomik yazım: yarım yazılmış manifest, arşivin tamamını okunamaz yapardı.
      await writeFile(tmp, `${JSON.stringify(this.manifest, null, 2)}\n`);
      await rename(tmp, target);
    };
    // then(task, task): önceki yazım hata verdiyse de sıradaki denensin.
    const run = this.saveQueue.then(task, task);
    // Zincirin kalıcı olarak "rejected" kalmasını engelle, hatayı çağırana bırak.
    this.saveQueue = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    for (const filePath of [...this.streams.keys()]) await this.closeStream(filePath);
    await this.saveManifest();
    logger.info({ dir: this.dir }, 'arşiv kapatıldı');
  }
}
