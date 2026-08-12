import { randomUUID } from 'node:crypto';
import type {
  AgentCommandResult,
  AgentEvent,
  AgentQuery,
  ApiToAgentMessage,
} from '@altai/contracts';
import { ApiToAgentMessage as ApiToAgentMessageSchema } from '@altai/contracts';
import { logger } from '@altai/shared';
import WebSocket from 'ws';
import type { Spool } from './spool.js';

export interface UplinkOptions {
  url: string;
  serverSlug: string;
  secret: string;
  /** Bağlantı yokken eventlerin biriktiği disk kuyruğu. */
  spool: Spool;
  onCommand: (message: Extract<ApiToAgentMessage, { type: 'command' }>) => void;
  /**
   * Plugin ayarları geldi (bağlanışta bir kez, sonra her değişiklikte).
   * Agent'ın Postgres erişimi olmadığı için ayarların tek geliş yolu bu.
   */
  onPluginConfigs?: (configs: Extract<ApiToAgentMessage, { type: 'plugin_configs' }>) => void;
  /** Oyun içi yetki listesi — plugin muafiyetlerinin tek kaynağı. */
  onAdminList?: (msg: Extract<ApiToAgentMessage, { type: 'admin_list' }>) => void;
}

export interface Uplink {
  send(event: AgentEvent): void;
  /**
   * Komut sonucunu api'ye bildirir.
   *
   * Spool'a DÜŞMEZ: bağlantı koptuysa api tarafındaki bekleyen komut zaten
   * zaman aşımına uğramıştır ve geç gelen bir cevabın karşılığı kalmaz.
   * Eventlerden farkı bu — event kaybolmamalı, komut cevabı kısa ömürlü.
   */
  sendCommandResult(result: AgentCommandResult): void;
  /**
   * api'ye veri sorar ve cevabı bekler.
   *
   * Plugin'lerin veritabanı erişimi yok; "bu oyuncunun etiketi var mı"
   * sorusunun tek yolu bu. Hiçbir durumda throw ETMEZ: bağlantı kopuksa ya
   * da cevap gecikirse `null` döner, çağıran plugin buna göre karar verir.
   * Bir dış sorgunun başarısız olması oyun mantığını durdurmamalı.
   */
  sorgu(query: AgentQuery): Promise<unknown | null>;
  /** Düzgün kapanış: api'ye shutdown bildirir, açık session'lar kapatılsın. */
  shutdown(): Promise<void>;
}

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export function createUplink(opts: UplinkOptions): Uplink {
  let ws: WebSocket | undefined;
  let closed = false;
  let reconnectDelay = RECONNECT_BASE_MS;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  // hello_ack gelene kadar hiçbir event gönderilmez: api slug -> UUID
  // çözümlemesini bitirmeden gelen eventleri bellekte kuyruklamak zorunda kalır.
  let acked = false;
  // Spool boşalana kadar canlı gönderim yapılmaz, yoksa yeni eventler
  // spool'daki eskileri geçer ve sıra bozulur.
  let draining = false;

  const canSend = () => ws?.readyState === WebSocket.OPEN && acked;

  /**
   * Cevabı beklenen sorgular.
   *
   * Zaman aşımı ŞART: api yanıt vermezse plugin'in sözü sonsuza kadar
   * asılı kalır ve o plugin bir daha hiçbir olayı işleyemez.
   */
  const SORGU_ZAMAN_ASIMI_MS = 10_000;
  const bekleyenSorgular = new Map<
    string,
    { cozumle: (v: unknown | null) => void; zamanlayici: ReturnType<typeof setTimeout> }
  >();

  const sendNow = (event: AgentEvent): boolean => {
    if (!canSend()) return false;
    try {
      ws?.send(JSON.stringify({ type: 'event', event }));
      return true;
    } catch {
      return false;
    }
  };

  async function drainSpool() {
    if (draining) return;
    draining = true;
    try {
      await opts.spool.drain(sendNow);
    } catch (err) {
      logger.error({ err }, 'spool boşaltılamadı');
    } finally {
      draining = false;
    }

    // Boşaltma sürerken üretilen bir event, yazımı tamamlanmadan tur bittiyse
    // diskte kalmış olabilir. Tetiklenmeyi bir sonraki yeniden bağlanmaya
    // bırakırsak o event saatlerce bekler — burada hemen tekrar deniyoruz.
    if (canSend() && opts.spool.hasPending()) {
      setTimeout(() => void drainSpool(), 100);
    }
  }

  function connect() {
    if (closed) return;
    ws = new WebSocket(opts.url);

    ws.on('open', () => {
      reconnectDelay = RECONNECT_BASE_MS;
      logger.info({ url: opts.url }, 'api uplink bağlandı, hello gönderiliyor');
      ws?.send(JSON.stringify({ type: 'hello', serverSlug: opts.serverSlug, secret: opts.secret }));
    });

    ws.on('message', (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const result = ApiToAgentMessageSchema.safeParse(parsed);
      if (!result.success) {
        // ESKİDEN SESSİZCE ATILIYORDU. api komut gönderip cevap bekliyor,
        // agent hiçbir şey söylemiyordu; tek belirti api tarafındaki zaman
        // aşımıydı ve sebebi görünmüyordu. Doğrulamadan geçmeyen mesaj artık
        // ne olduğuyla birlikte loglanıyor.
        logger.error(
          {
            tip: (parsed as { type?: unknown } | null)?.type,
            hata: result.error.issues.slice(0, 3),
          },
          'api mesajı doğrulanamadı — YOK SAYILDI',
        );
        return;
      }

      const msg = result.data;
      if (msg.type === 'hello_ack') {
        acked = true;
        logger.info({ serverId: msg.serverId }, 'api uplink kimlik doğrulandı');
        if (opts.spool.hasPending()) {
          logger.info({ bayt: opts.spool.size() }, 'biriken eventler gönderiliyor');
          void drainSpool();
        }
      } else if (msg.type === 'hello_reject') {
        logger.error(
          { reason: msg.reason },
          'api uplink reddedildi — AGENT_SHARED_SECRET kontrol et',
        );
      } else if (msg.type === 'command') {
        logger.info(
          { action: msg.command.action, correlationId: msg.command.correlationId },
          'komut alındı',
        );
        opts.onCommand(msg);
      } else if (msg.type === 'plugin_configs') {
        logger.info(
          { adet: msg.configs.length, acik: msg.configs.filter((c) => c.enabled).length },
          'plugin ayarları alındı',
        );
        opts.onPluginConfigs?.(msg);
      } else if (msg.type === 'admin_list') {
        logger.info({ adet: msg.admins.length }, 'oyun içi yetki listesi alındı');
        opts.onAdminList?.(msg);
      } else if (msg.type === 'query_result') {
        const kayit = bekleyenSorgular.get(msg.result.correlationId);
        if (!kayit) {
          // Zaman aşımına uğramış bir sorgunun geç gelen cevabı olabilir.
          return;
        }
        clearTimeout(kayit.zamanlayici);
        bekleyenSorgular.delete(msg.result.correlationId);
        kayit.cozumle(msg.result.ok ? (msg.result.data ?? null) : null);
      }
    });

    ws.on('close', () => {
      acked = false;
      // Bekleyen sorgular hemen çözülüyor: bağlantı gittiyse cevap
      // gelmeyecek ve plugin'i zaman aşımına kadar bekletmenin anlamı yok.
      for (const [id, kayit] of bekleyenSorgular) {
        clearTimeout(kayit.zamanlayici);
        kayit.cozumle(null);
        bekleyenSorgular.delete(id);
      }
      if (closed) return;
      logger.warn({ delayMs: reconnectDelay }, 'api uplink koptu, yeniden bağlanılacak');
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);
    });

    ws.on('error', (err) => {
      logger.error({ err }, 'api uplink hatası');
    });
  }

  connect();

  return {
    sendCommandResult(result) {
      if (ws?.readyState !== WebSocket.OPEN) {
        logger.warn(
          { correlationId: result.correlationId },
          'komut sonucu gönderilemedi (bağlantı yok)',
        );
        return;
      }
      ws.send(JSON.stringify({ type: 'command_result', result }));
    },

    sorgu(query) {
      if (!canSend()) return Promise.resolve(null);

      const correlationId = randomUUID();
      return new Promise<unknown | null>((resolve) => {
        const zamanlayici = setTimeout(() => {
          bekleyenSorgular.delete(correlationId);
          logger.warn({ kind: query.kind }, 'api sorgusu zaman aşımına uğradı');
          resolve(null);
        }, SORGU_ZAMAN_ASIMI_MS);

        bekleyenSorgular.set(correlationId, { cozumle: resolve, zamanlayici });

        try {
          ws?.send(JSON.stringify({ type: 'query', request: { correlationId, query } }));
        } catch (err) {
          clearTimeout(zamanlayici);
          bekleyenSorgular.delete(correlationId);
          logger.error({ err, kind: query.kind }, 'sorgu gönderilemedi');
          resolve(null);
        }
      });
    },

    send(event) {
      // Spool boşalmadan canlı gönderim yapılmaz — sıra korunmalı.
      if (canSend() && !draining && !opts.spool.hasPending()) {
        if (sendNow(event)) return;
      }
      void opts.spool.append(event).catch((err) => {
        // Buraya düşmek gerçek veri kaybı demek: ne gönderilebildi ne yazılabildi.
        logger.error({ err, type: event.type }, 'event ne gönderilebildi ne spool edildi');
      });
    },

    async shutdown() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);

      // Bağlantı varsa: kalanları gönder, sonra kapanışı bildir. Bağlantı
      // yoksa zaten her şey spool'da; api'ye bildirim gitmez ve açık
      // session'ları bir sonraki bağlantıda reconciler toparlar.
      if (canSend()) {
        await drainSpool();
        try {
          ws?.send(JSON.stringify({ type: 'shutdown', timestamp: new Date().toISOString() }));
          // Mesajın hattan çıkması için kısa bir an tanı.
          await new Promise((resolve) => setTimeout(resolve, 250));
        } catch (err) {
          logger.warn({ err }, 'shutdown bildirimi gönderilemedi');
        }
      }
      ws?.close();
    },
  };
}
