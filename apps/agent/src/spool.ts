import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { appendFile, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { AgentEvent } from '@altai/contracts';
import { logger } from '@altai/shared';

/**
 * Disk üstü event kuyruğu.
 *
 * Agent artık Postgres'e doğrudan yazmıyor; kalıcı veri api'ye WS ile gidiyor.
 * Bu, kalıcılığı tek bir kanala bağladı: api ya da ağ düşerse event'ler
 * kaybolurdu. Spool bunu engeller — bağlantı yokken event'ler diske yazılır,
 * bağlantı gelince sırayla gönderilir.
 *
 * Sıra korunur: boşaltma sırasında üretilen yeni event'ler de spool'a yazılır,
 * canlı gönderime ancak spool tamamen boşaldığında geçilir. Aksi hâlde yeni
 * event'ler eski olanları geçer ve session'lar yanlış sırada işlenirdi.
 *
 * İki dosya kullanılır: `spool.ndjson` yazım hedefi, boşaltma başlarken
 * `spool.draining.ndjson`'a rename edilir. Böylece okuma ile yazma çakışmaz
 * ve süreç ortada ölürse boşaltılmakta olan dosya diskte kalır.
 */

export interface Spool {
  /** Event'i kuyruğa yaz. */
  append(event: AgentEvent): Promise<void>;
  /** Kuyrukta bekleyen dosya var mı (boşaltılmakta olan dahil). */
  hasPending(): boolean;
  /**
   * Kuyruğu boşalt. `send` false dönerse (bağlantı koptu) boşaltma durur ve
   * gönderilmemiş kısım diskte kalır. Tamamen boşaldıysa true döner.
   */
  drain(send: (event: AgentEvent) => boolean): Promise<boolean>;
  /** Kuyrukta kaç bayt bekliyor (log/teşhis için). */
  size(): number;
}

export interface SpoolOptions {
  dir: string;
  /**
   * Üst sınır. Aşılırsa yeni event'ler DÜŞÜRÜLÜR (en eskiyi silmek yerine):
   * uzun bir kesintide en değerli veri kesintinin başındaki session
   * açılışlarıdır, sonu değil. Dolduğu her seferinde uyarı basılır.
   */
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 256 * 1024 * 1024; // 256 MB ~ günlerce kesinti

export function createSpool(opts: SpoolOptions): Spool {
  mkdirSync(opts.dir, { recursive: true });
  const activePath = path.join(opts.dir, 'spool.ndjson');
  const drainingPath = path.join(opts.dir, 'spool.draining.ndjson');
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  let warnedFull = false;

  const fileSize = (p: string) => {
    try {
      return statSync(p).size;
    } catch {
      return 0;
    }
  };

  const size = () => fileSize(activePath) + fileSize(drainingPath);

  return {
    async append(event) {
      if (size() >= maxBytes) {
        if (!warnedFull) {
          warnedFull = true;
          logger.error(
            { dir: opts.dir, maxBytes },
            'spool doldu — yeni eventler düşürülüyor. api uzun süredir erişilemiyor.',
          );
        }
        return;
      }
      warnedFull = false;
      await appendFile(activePath, `${JSON.stringify(event)}\n`);
    },

    hasPending() {
      return existsSync(activePath) || existsSync(drainingPath);
    },

    size,

    async drain(send) {
      for (;;) {
        // Önceki boşaltmadan kalan dosya varsa önce onu bitir.
        if (!existsSync(drainingPath)) {
          if (!existsSync(activePath) || fileSize(activePath) === 0) return true;
          renameSync(activePath, drainingPath);
        }

        const content = await readFile(drainingPath, 'utf8');
        const lines = content.split('\n').filter(Boolean);

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line) continue;
          let event: AgentEvent;
          try {
            event = JSON.parse(line) as AgentEvent;
          } catch {
            continue; // çökmede yarım kalmış satır — atla
          }

          if (!send(event)) {
            // Bağlantı koptu. Gönderilmemiş kısmı dosyaya geri yaz ki
            // sıradaki denemede baştan değil kaldığı yerden devam etsin.
            const remaining = lines.slice(i).join('\n');
            await appendFile(`${drainingPath}.tmp`, `${remaining}\n`);
            renameSync(`${drainingPath}.tmp`, drainingPath);
            logger.warn({ kalan: lines.length - i }, 'spool boşaltma yarıda kesildi');
            return false;
          }
        }

        await unlink(drainingPath).catch(() => undefined);
        logger.info({ gonderilen: lines.length }, 'spool boşaltıldı');
        // Boşaltma sırasında yeni eventler active dosyaya yazılmış olabilir;
        // döngü başa dönüp onları da gönderir.
      }
    },
  };
}
