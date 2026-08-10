import type { AgentToApiMessage } from '@altai/contracts';
import { AgentToApiMessage as AgentToApiMessageSchema } from '@altai/contracts';
import type { Db } from '@altai/db';
import type { AppConfig } from '@altai/shared';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { kaydet } from '../lib/activity-log.js';
import { agentBaglandi, agentKoptu, komutSonucuGeldi } from '../lib/agent-command-bus.js';
import { girisAninda, kipiAyarla, taramayiBaslat } from '../lib/ban-enforcer.js';
import { olayYayinla } from '../lib/live-feed.js';
import { otomatikMi } from '../lib/otomatik-mesaj.js';
import { panelKomutuMu } from '../lib/panel-komut-izi.js';
import {
  closeAllOpenSessions,
  createPersistenceWriter,
  reconcileStaleSessions,
} from '../lib/persistence-writer.js';
import { tazelemeyiBaslat } from '../lib/player-refresh.js';
import { resolveServerId } from '../lib/server-registry.js';
import {
  applyPlayerConnected,
  applyPlayerDisconnected,
  applyServerSnapshot,
  oyuncuAdi,
} from '../lib/server-state.js';
import { macSonuIsle } from '../lib/team-change.js';
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
  // Canlı oyuncu listesini RCON'dan tazeler: olaylardan türeyen liste
  // takım/manga taşımıyor ve kaçırılan çıkışlarla ayrışıyor.
  const tazelemeyiDurdur = tazelemeyiBaslat(db);
  app.addHook('onClose', async () => {
    taramayiDurdur();
    tazelemeyiDurdur();
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
          olayYayinla({
            tur: 'join',
            serverSlug,
            steamId: event.steamId,
            name: event.name,
            timestamp: event.timestamp,
          });
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
          olayYayinla({
            tur: 'leave',
            serverSlug,
            steamId: event.steamId,
            // Ad, oyuncu listeden çıkarılmadan ÖNCE okunmalı.
            name: oyuncuAdi(serverSlug, event.steamId),
            timestamp: event.timestamp,
          });
          applyPlayerDisconnected(serverSlug, event.steamId);
          break;
        case 'SERVER_SNAPSHOT':
          applyServerSnapshot(
            serverSlug,
            event.playerCount,
            event.queueCount,
            event.layer,
            event.tickRate,
          );
          break;
        case 'CHAT_MESSAGE':
          // İsmi olay taşımıyor; canlı oyuncu listesinden çözülüyor.
          olayYayinla({
            tur: 'chat',
            serverSlug,
            steamId: event.steamId,
            name: oyuncuAdi(serverSlug, event.steamId),
            channel: event.channel,
            message: event.message,
            timestamp: event.timestamp,
          });
          break;
        case 'SQUAD_CREATED':
          olayYayinla({
            tur: 'squad',
            serverSlug,
            steamId: event.steamId ?? null,
            name: event.playerName,
            squadId: event.squadId,
            squadName: event.squadName,
            timestamp: event.timestamp,
          });
          break;
        case 'ROUND_ENDED': {
          // Maç sonuna ertelenmiş takım değişimlerinin tetikleyicisi.
          // Beklemiyoruz: kalıcı yazımı geciktirmesin. Hata olursa
          // kuyruk kaydı açık kalır ve bir sonraki maç sonunda tekrar
          // denenir — söz verilen değişim kaybolmaz.
          const sid = serverId;
          const sslug = serverSlug;
          if (sid) {
            void macSonuIsle(db, sslug, sid).catch((err) =>
              app.log.error({ err, serverSlug: sslug }, 'maç sonu takım değişimleri işlenemedi'),
            );
          }
          break;
        }
        case 'ADMIN_ACTION': {
          // Oyun içinden yapılan yetkili işlemleri. Akışta her zaman
          // görünüyor: panelden gönderilmiş olsa bile "komut oyuna ulaştı"
          // teyidi değerli.
          olayYayinla({
            tur: 'admin',
            serverSlug,
            steamId: event.steamId ?? null,
            name: event.playerName ?? null,
            adminIslem: event.action,
            ...(event.message ? { message: event.message } : {}),
            ...(event.interval ? { sure: event.interval } : {}),
            timestamp: event.timestamp,
          });

          // Günlüğe YALNIZCA panelden geçmeyenler yazılıyor; panelin kendi
          // komutu zaten player.warn / player.kick olarak kayıtlı ve yankısı
          // ikinci bir satır olsaydı aynı işlem iki kez sayılırdı.
          // Yalnızca panelin de gönderebildiği üç işlem için yankı
          // kontrolü yapılıyor; duyuru ve admin kamerası panelden hiç
          // gönderilmiyor, dolayısıyla yankı olamazlar.
          const panelinKendisi =
            (event.action === 'warn' || event.action === 'kick' || event.action === 'ban') &&
            panelKomutuMu(serverSlug, event.action, event.playerName ?? null);
          // Sunucudaki eklentiler (manga uyarısı, TK özür sistemi, hoş
          // geldin mesajı) insan yetkiliyle AYNI kanaldan yazıyor ve
          // ölçüldüğünde günlüğün %65'ini kaplıyorlardı. Ayrı eylem adına
          // alınıyorlar: düşürülmüyor ama moderasyon kırılımını
          // boğmuyorlar.
          const otomatik =
            (event.action === 'warn' || event.action === 'broadcast') &&
            otomatikMi(serverSlug, event.message);

          if (!panelinKendisi) {
            kaydet({
              actorType: 'game_server',
              actorLabel: serverSlug,
              action: otomatik ? `ingame.${event.action}_auto` : `ingame.${event.action}`,
              category: otomatik || event.action === 'broadcast' ? 'sistem' : 'moderasyon',
              targetType: 'player',
              targetLabel: event.playerName ?? event.steamId ?? null,
              payload: {
                ...(event.message ? { mesaj: event.message } : {}),
                ...(event.interval ? { sure: event.interval } : {}),
                ...(event.steamId ? { steamId: event.steamId } : {}),
              },
            });
          }
          break;
        }
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
          // Yanlış sırla bağlanma denemesi: oyun sunucusu kılığında gelen
          // bir bağlantı canlı oyuncu listesini görebilirdi, kayda değer.
          kaydet({
            actorType: 'system',
            actorLabel: 'agent-ws',
            action: 'agent.auth_failed',
            category: 'sistem',
            targetLabel: msg.serverSlug,
          });
          socket.send(JSON.stringify({ type: 'hello_reject', reason: 'invalid_secret' }));
          socket.close();
          return;
        }
        serverSlug = msg.serverSlug;
        app.log.info({ serverSlug }, 'agent uplink bağlandı');
        kaydet({
          actorType: 'agent',
          actorLabel: msg.serverSlug,
          action: 'agent.connect',
          category: 'sistem',
          targetType: 'server',
          targetLabel: msg.serverSlug,
        });

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
          kaydet({
            actorType: 'agent',
            actorLabel: serverSlug,
            action: 'agent.shutdown',
            category: 'sistem',
            targetType: 'server',
            targetLabel: serverSlug,
          });
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
        kaydet({
          actorType: 'agent',
          actorLabel: serverSlug,
          action: 'agent.disconnect',
          category: 'sistem',
          targetType: 'server',
          targetLabel: serverSlug,
        });
      }
    });
  });
}
