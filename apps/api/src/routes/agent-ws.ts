import type { AgentToApiMessage } from '@altai/contracts';
import { AgentToApiMessage as AgentToApiMessageSchema } from '@altai/contracts';
import type { Db } from '@altai/db';
import type { AppConfig } from '@altai/shared';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { agentBaglandi, agentKoptu, komutSonucuGeldi } from '../lib/agent-command-bus.js';
import { girisAninda, kipiAyarla, taramayiBaslat } from '../lib/ban-enforcer.js';
import { sohbetYayinla } from '../lib/live-chat.js';
import {
  closeAllOpenSessions,
  createPersistenceWriter,
  reconcileStaleSessions,
} from '../lib/persistence-writer.js';
import { resolveServerId } from '../lib/server-registry.js';
import {
  applyPlayerConnected,
  applyPlayerDisconnected,
  applyServerSnapshot,
  oyuncuAdi,
} from '../lib/server-state.js';
import { timingSafeCompare } from '../lib/timing-safe.js';

export async function agentWsRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig }) {
  const { db, config } = opts;

  // Tek yazıcı tüm agent bağlantıları için paylaşılır: raw_events batch'i
  // sunucu bazında değil global tutulur, böylece iki sunucudan gelen eventler
  // tek insert'te gider.
  const writer = createPersistenceWriter(db);
  // Periyodik ban taraması: giriş anındaki kontrolün kaçırdıklarını ve
  // oyuncu içerideyken yenen banları yakalar.
  kipiAyarla(config.BAN_ENFORCEMENT);
  const taramayiDurdur = taramayiBaslat(db);
  app.addHook('onClose', async () => {
    taramayiDurdur();
    await writer.stop();
  });

  app.get('/agent-ws', { websocket: true }, (socket: WebSocket) => {
    let serverSlug: string | null = null;
    let serverId: string | null = null;
    // hello ile serverId çözülene kadar gelen eventler burada bekler. Agent
    // hello'yu ilk mesaj olarak gönderiyor ama spool boşaltması hemen ardından
    // başlıyor; çözümleme async olduğu için ilk paket bu kuyruğa düşebilir.
    const pending: AgentToApiMessage[] = [];
    // Çözümleme birkaç milisaniye sürer, ama askıda kalırsa bu kuyruk belleği
    // yer bitirene kadar büyürdü. Üst sınıra gelinirse bağlantı kapatılır:
    // agent yeniden bağlanır ve spool'undan tekrar gönderir, veri kaybolmaz.
    const PENDING_MAX = 10_000;
    let ready = false;

    const persist = (msg: AgentToApiMessage) => {
      if (!serverId || !serverSlug) return;
      if (msg.type !== 'event') return;
      const event = msg.event;

      writer.write(serverId, event);

      switch (event.type) {
        case 'PLAYER_CONNECTED': {
          applyPlayerConnected(serverSlug, event.steamId, event.name, event.timestamp);
          // Ban uygulaması: girer girmez kontrol. Beklemiyoruz — kalıcı
          // yazımı geciktirmesin; başarısız olursa periyodik tarama yakalar.
          const sslug = serverSlug;
          const sid = serverId;
          if (sid) {
            void girisAninda(db, sslug, sid, event.steamId, event.eosId ?? null).catch((err) =>
              app.log.error({ err, steamId: event.steamId }, 'giriş anı ban kontrolü başarısız'),
            );
          }
          break;
        }
        case 'PLAYER_DISCONNECTED':
          applyPlayerDisconnected(serverSlug, event.steamId);
          break;
        case 'SERVER_SNAPSHOT':
          applyServerSnapshot(serverSlug, event.playerCount, event.queueCount, event.layer);
          break;
        case 'CHAT_MESSAGE':
          // İsmi olay taşımıyor; canlı oyuncu listesinden çözülüyor.
          sohbetYayinla({
            serverSlug,
            steamId: event.steamId,
            name: oyuncuAdi(serverSlug, event.steamId),
            channel: event.channel,
            message: event.message,
            timestamp: event.timestamp,
          });
          break;
        case 'CHAT_MESSAGE':
          // Faz 3'te bot'a / admin cam benzeri özelliklere yönlendirilecek.
          // Şimdilik raw_events'te duruyor (writer yazdı).
          break;
      }
    };

    socket.on('message', (raw: Buffer) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }

      const result = AgentToApiMessageSchema.safeParse(parsed);
      if (!result.success) return;
      const msg: AgentToApiMessage = result.data;

      if (msg.type === 'hello') {
        // Sabit zamanlı: !== ilk farklı karakterde durur ve yanıt süresi
        // sırrı karakter karakter sızdırabilir.
        if (
          !config.AGENT_SHARED_SECRET ||
          !timingSafeCompare(msg.secret, config.AGENT_SHARED_SECRET)
        ) {
          socket.send(JSON.stringify({ type: 'hello_reject', reason: 'invalid_secret' }));
          socket.close();
          return;
        }
        serverSlug = msg.serverSlug;
        app.log.info({ serverSlug }, 'agent uplink bağlandı');

        // Slug -> UUID çözümlemesi (yoksa satır oluşturulur) ve ardından
        // reconciler: bir önceki çalıştırmadan crash nedeniyle açık kalmış
        // session'ları 4 saat üst sınırıyla kapatır. Agent artık DB'ye
        // dokunmadığı için bu iş buraya taşındı.
        void (async () => {
          try {
            const id = await resolveServerId(db, msg.serverSlug, msg.serverSlug);
            await reconcileStaleSessions(db, id);
            serverId = id;
            ready = true;
            // Komut kanalına kaydol: bundan sonra api bu sunucuya kick/warn
            // gönderebilir. hello DOĞRULANDIKTAN sonra yapılıyor — aksi hâlde
            // secret'ı bilmeyen bir bağlantı komut alabilirdi.
            agentBaglandi(msg.serverSlug, { send: (d) => socket.send(d) });
            socket.send(JSON.stringify({ type: 'hello_ack', serverId: id }));
            for (const queued of pending.splice(0)) persist(queued);
          } catch (err) {
            app.log.error({ err, serverSlug }, 'agent hello işlenemedi');
            socket.send(JSON.stringify({ type: 'hello_reject', reason: 'server_error' }));
            socket.close();
          }
        })();
        return;
      }

      if (!serverSlug) return; // hello gelmeden hiçbir mesaj kabul edilmez

      if (msg.type === 'shutdown') {
        // Agent düzgün kapanıyor: açık session'ları gerçek zamanla kapat.
        // WS'in kendiliğinden kopması bunu TETİKLEMEZ — geçici ağ kesintisi
        // de aynı görünür ve oyuncular hâlâ oyunda olabilir.
        const id = serverId;
        if (id) {
          app.log.info({ serverSlug }, "agent düzgün kapanıyor, session'lar kapatılıyor");
          void closeAllOpenSessions(db, id).catch((err) =>
            app.log.error({ err, serverSlug }, 'kapanışta session kapatma başarısız'),
          );
        }
        return;
      }

      if (msg.type === 'event') {
        if (ready) {
          persist(msg);
        } else if (pending.length < PENDING_MAX) {
          pending.push(msg);
        } else {
          app.log.error(
            { serverSlug, pending: pending.length },
            'hello çözümlemesi tamamlanmadan kuyruk doldu — bağlantı kapatılıyor',
          );
          socket.close();
        }
        return;
      }

      if (msg.type === 'command_result') {
        // Bekleyen komutun promise'ini çözer (lib/agent-command-bus.ts).
        komutSonucuGeldi(msg.result);
      }
    });

    socket.on('close', () => {
      if (serverSlug) {
        agentKoptu(serverSlug);
        app.log.warn({ serverSlug }, 'agent uplink koptu');
      }
    });
  });
}
