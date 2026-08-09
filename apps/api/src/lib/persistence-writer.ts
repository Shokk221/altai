import type { AgentEvent } from '@altai/contracts';
import type { Db } from '@altai/db';
import { identitySchema, matchesSchema, presenceSchema } from '@altai/db';
import { logger } from '@altai/shared';
import { and, desc, eq, isNull } from 'drizzle-orm';

const RAW_EVENTS_FLUSH_INTERVAL_MS = 2_000;
const RAW_EVENTS_FLUSH_MAX_BATCH = 200;

/**
 * Kalıcı yazım katmanı — api'de çalışır.
 *
 * Başlangıçta agent'ın içindeydi (agent doğrudan Postgres'e yazıyordu). Tek
 * konteyner kararıyla birlikte buraya taşındı: Postgres artık yalnızca api'nin
 * localhost'undan erişilebilir, dışarı hiç açılmıyor. Agent kalıcı veriyi de
 * zaten açtığı WS üzerinden gönderiyor; kopukluk hâlinde diske spool ediyor
 * (bkz. apps/agent/src/spool.ts), yani veri kaybı riski taşınmadı.
 */
export interface PersistenceWriter {
  /** serverId, hello anında slug'dan çözülür ve bağlantı boyunca sabittir. */
  write(serverId: string, event: AgentEvent): void;
  stop(): Promise<void>;
}

// Kapanışta (SIGTERM/SIGINT) açık kalan tüm session'ları kapatır — yoksa
// restart'ta devam eden oyuncu süresi kaybolur (plan: "Graceful shutdown zorunlu").
export async function closeAllOpenSessions(db: Db, serverId: string) {
  await db
    .update(presenceSchema.gameSessions)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(presenceSchema.gameSessions.serverId, serverId),
        isNull(presenceSchema.gameSessions.leftAt),
      ),
    );
}

const RECONCILER_MAX_SESSION_MS = 4 * 60 * 60 * 1000; // 4 saat (eski backfill kuralı)

// Agent başlangıcında çağrılır: bir önceki çalıştırmadan crash nedeniyle
// açık kalmış session'ları (DISCONNECT eventi hiç gelmemiş) 4 saatlik üst
// sınırla kapatır. Bkz. plan Bölüm 5.5-B.
export async function reconcileStaleSessions(db: Db, serverId: string) {
  const openSessions = await db
    .select()
    .from(presenceSchema.gameSessions)
    .where(
      and(
        eq(presenceSchema.gameSessions.serverId, serverId),
        isNull(presenceSchema.gameSessions.leftAt),
      ),
    );

  for (const session of openSessions) {
    const cappedLeftAt = new Date(session.joinedAt.getTime() + RECONCILER_MAX_SESSION_MS);
    await db
      .update(presenceSchema.gameSessions)
      .set({ leftAt: cappedLeftAt, closedByReconciler: true })
      .where(eq(presenceSchema.gameSessions.id, session.id));
  }

  if (openSessions.length > 0) {
    logger.warn(
      { serverId, count: openSessions.length },
      'reconciler: crash sonrası açık kalan session(lar) kapatıldı',
    );
  }
}

// Oyuncuyu steamId'ye göre bulur/oluşturur. EOS eşlemesi değişmişse eskisini
// silmeden player_id_history'e tarihçe olarak yazar (Bölüm 4.1 — eski sistemin
// sessizce sildiği çakışma sorununun çözümü).
async function upsertPlayer(db: Db, steamId: string, eosId: string | undefined, name: string) {
  const [existing] = await db
    .select()
    .from(identitySchema.players)
    .where(eq(identitySchema.players.steamId, steamId))
    .limit(1);

  if (!existing) {
    const [created] = await db
      .insert(identitySchema.players)
      .values({ steamId, eosId: eosId ?? null })
      .returning();
    return created;
  }

  if (eosId && existing.eosId && existing.eosId !== eosId) {
    await db.insert(identitySchema.playerIdHistory).values({
      playerId: existing.id,
      previousEosId: existing.eosId,
    });
  }
  if (eosId && existing.eosId !== eosId) {
    await db
      .update(identitySchema.players)
      .set({ eosId })
      .where(eq(identitySchema.players.id, existing.id));
  }

  void name; // İsim geçmişi (player_names, Bölüm 4.1) Faz 4'te eklenecek

  return existing;
}

export function createPersistenceWriter(db: Db): PersistenceWriter {
  let rawEventQueue: { serverId: string; eventType: string; payload: unknown }[] = [];
  let stopped = false;

  const flushTimer = setInterval(() => void flushRawEvents(), RAW_EVENTS_FLUSH_INTERVAL_MS);

  async function flushRawEvents() {
    if (rawEventQueue.length === 0) return;
    const batch = rawEventQueue;
    rawEventQueue = [];
    try {
      await db.insert(presenceSchema.rawEvents).values(batch);
    } catch (err) {
      logger.error({ err, count: batch.length }, 'raw_events batch insert başarısız oldu');
    }
  }

  async function handlePlayerConnected(
    serverId: string,
    event: Extract<AgentEvent, { type: 'PLAYER_CONNECTED' }>,
  ) {
    const player = await upsertPlayer(db, event.steamId, event.eosId, event.name);
    if (!player) return;

    // Açık kalan eski bir session varsa (crash sonrası) reconciler onu kapatır;
    // burada sadece yeni session açılır.
    await db.insert(presenceSchema.gameSessions).values({
      serverId,
      playerId: player.id,
      joinedAt: new Date(event.timestamp),
    });
  }

  async function handlePlayerDisconnected(
    serverId: string,
    event: Extract<AgentEvent, { type: 'PLAYER_DISCONNECTED' }>,
  ) {
    const [player] = await db
      .select()
      .from(identitySchema.players)
      .where(eq(identitySchema.players.steamId, event.steamId))
      .limit(1);
    if (!player) return;

    const [openSession] = await db
      .select()
      .from(presenceSchema.gameSessions)
      .where(
        and(
          eq(presenceSchema.gameSessions.serverId, serverId),
          eq(presenceSchema.gameSessions.playerId, player.id),
          isNull(presenceSchema.gameSessions.leftAt),
        ),
      )
      .limit(1);
    if (!openSession) return; // eventler sırasız gelmiş olabilir, sessizce atla

    await db
      .update(presenceSchema.gameSessions)
      .set({ leftAt: new Date(event.timestamp) })
      .where(eq(presenceSchema.gameSessions.id, openSession.id));
  }

  async function handleServerSnapshot(
    serverId: string,
    event: Extract<AgentEvent, { type: 'SERVER_SNAPSHOT' }>,
  ) {
    await db.insert(presenceSchema.serverSnapshots).values({
      serverId,
      playerCount: event.playerCount,
      queueCount: event.queueCount,
      layer: event.layer ?? null,
      takenAt: new Date(event.timestamp),
    });
  }

  /**
   * Maç başlangıcı.
   *
   * Sunucu bir maçı bitirmeden yeniden başlarsa o maç `ended_at` null olarak
   * kalır. Bunu yeni maçın başlangıç zamanıyla kapatmıyoruz: aradaki harita
   * yükleme ve çöküş süresi maç süresine yazılır, yanlış istatistik üretirdi.
   * Yarım kalan maç yarım kalmış olarak duruyor; eşleştirme kuralı "en son
   * başlayan açık maç" olduğu için bu, sonraki maçların doğruluğunu bozmaz.
   */
  async function handleRoundStarted(
    serverId: string,
    event: Extract<AgentEvent, { type: 'ROUND_STARTED' }>,
  ) {
    await db.insert(matchesSchema.rounds).values({
      serverId,
      layer: event.layer ?? null,
      map: event.map ?? null,
      startedAt: new Date(event.timestamp),
      source: 'altai',
    });
  }

  /**
   * Maç bitişi — o sunucunun en son başlamış maçını kapatır.
   *
   * ROUND_ENDED ayrı bir maç kimliği taşımıyor (SquadJS öyle üretmiyor),
   * bu yüzden eşleştirme "aynı sunucuda en son başlayan, henüz bitmemiş maç"
   * kuralıyla yapılıyor. Agent yeniden başladığında ROUND_STARTED'ı kaçırmış
   * olabilir; o durumda kapatılacak maç bulunamaz ve olay sessizce yalnızca
   * raw_events'te kalır — uydurma bir maç kaydı üretmiyoruz.
   */
  async function handleRoundEnded(
    serverId: string,
    event: Extract<AgentEvent, { type: 'ROUND_ENDED' }>,
  ) {
    const [open] = await db
      .select({ id: matchesSchema.rounds.id, startedAt: matchesSchema.rounds.startedAt })
      .from(matchesSchema.rounds)
      .where(and(eq(matchesSchema.rounds.serverId, serverId), isNull(matchesSchema.rounds.endedAt)))
      .orderBy(desc(matchesSchema.rounds.startedAt))
      .limit(1);
    if (!open) {
      logger.warn({ event }, 'ROUND_ENDED geldi ama açık maç yok — atlandı');
      return;
    }

    const endedAt = new Date(event.timestamp);
    const winner = event.winnerTeam;
    await db
      .update(matchesSchema.rounds)
      .set({
        endedAt,
        durationSeconds: Math.max(0, Math.round((+endedAt - +open.startedAt) / 1000)),
        winnerTeam: winner ?? null,
        // Ticket'lar kazanan/kaybeden olarak geliyor, takım numarasına
        // çevirmek için kazananın hangi takım olduğunu bilmek gerekiyor.
        team1Tickets: winner === 1 ? (event.winnerTickets ?? null) : (event.loserTickets ?? null),
        team2Tickets: winner === 2 ? (event.winnerTickets ?? null) : (event.loserTickets ?? null),
        team1Faction: winner === 1 ? (event.winnerFaction ?? null) : (event.loserFaction ?? null),
        team2Faction: winner === 2 ? (event.winnerFaction ?? null) : (event.loserFaction ?? null),
      })
      .where(eq(matchesSchema.rounds.id, open.id));
  }

  return {
    write(serverId, event) {
      if (stopped) return;

      rawEventQueue.push({ serverId, eventType: event.type, payload: event });
      if (rawEventQueue.length >= RAW_EVENTS_FLUSH_MAX_BATCH) void flushRawEvents();

      // Yapısal tablolara yazım event bazında olur (session/player mantığı
      // batch'lenemeyecek kadar durumsal); yalnızca ham arşiv batch'lenir.
      switch (event.type) {
        case 'PLAYER_CONNECTED':
          void handlePlayerConnected(serverId, event).catch((err) =>
            logger.error({ err, event }, 'PLAYER_CONNECTED işlenemedi'),
          );
          break;
        case 'PLAYER_DISCONNECTED':
          void handlePlayerDisconnected(serverId, event).catch((err) =>
            logger.error({ err, event }, 'PLAYER_DISCONNECTED işlenemedi'),
          );
          break;
        case 'SERVER_SNAPSHOT':
          void handleServerSnapshot(serverId, event).catch((err) =>
            logger.error({ err, event }, 'SERVER_SNAPSHOT işlenemedi'),
          );
          break;
        case 'ROUND_STARTED':
          void handleRoundStarted(serverId, event).catch((err) =>
            logger.error({ err, event }, 'ROUND_STARTED işlenemedi'),
          );
          break;
        case 'ROUND_ENDED':
          void handleRoundEnded(serverId, event).catch((err) =>
            logger.error({ err, event }, 'ROUND_ENDED işlenemedi'),
          );
          break;
        case 'CHAT_MESSAGE':
          // Şimdilik sadece raw_events'te duruyor; chat log tablosu Faz 3/4
          // kapsamında (moderasyon/plugin ihtiyaçları netleşince) eklenecek.
          break;
      }
    },
    async stop() {
      stopped = true;
      clearInterval(flushTimer);
      await flushRawEvents();
    },
  };
}
