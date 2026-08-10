import type { AgentEvent } from '@altai/contracts';
import type {
  SquadJSChatMessageRaw,
  SquadJSEngine,
  SquadJSNewGameRaw,
  SquadJSPlayerConnectedRaw,
  SquadJSPlayerDisconnectedRaw,
  SquadJSRoundEndedRaw,
  SquadJSSquadCreatedRaw,
  SquadJSTickRateRaw,
} from './engine.js';

const CHAT_CHANNEL_MAP: Record<SquadJSChatMessageRaw['chat'], 'All' | 'Team' | 'Squad' | 'Admin'> =
  {
    ChatAll: 'All',
    ChatTeam: 'Team',
    ChatSquad: 'Squad',
    ChatAdmin: 'Admin',
  };

export interface SquadJSAdapterOptions {
  // Sunucunun kısa adı (agent .env'indeki SERVER_SLUG). DB UUID'si DEĞİL —
  // agent veritabanına dokunmaz, slug -> UUID çözümlemesini api yapar.
  serverSlug: string;
  engine: SquadJSEngine;
  onEvent: (event: AgentEvent) => void;
  // player henüz RCON'un ListPlayers'ında görünmediği için eşleştirilemeyen
  // eventler için (gerçek fork'ta olur, bkz. plan notu) — opsiyonel, verilmezse sessizce atlanır.
  onUnmatchedPlayer?: (
    eosId: string,
    eventType: 'PLAYER_CONNECTED' | 'PLAYER_DISCONNECTED',
  ) => void;
  // Snapshot aralığı (ms) — plan varsayılanı 60 sn
  snapshotIntervalMs?: number;
}

export interface SquadJSAdapterHandle {
  start(): void;
  stop(): void;
}

export function createSquadJSAdapter(opts: SquadJSAdapterOptions): SquadJSAdapterHandle {
  const { serverSlug, engine, onEvent } = opts;
  const snapshotIntervalMs = opts.snapshotIntervalMs ?? 60_000;
  // Bu süredir yeni tick satırı görülmediyse değer bayat sayılır. Log
  // satırı ~30 sn'de bir düşüyor; üç kaçırılan satır sorun işareti.
  const TICK_TAZELIK_MS = 3 * 60_000;
  let snapshotTimer: ReturnType<typeof setInterval> | undefined;

  const handleConnected = (raw: SquadJSPlayerConnectedRaw) => {
    if (!raw.player) {
      opts.onUnmatchedPlayer?.(raw.eosID, 'PLAYER_CONNECTED');
      return;
    }
    onEvent({
      type: 'PLAYER_CONNECTED',
      serverSlug,
      steamId: raw.player.steamID,
      eosId: raw.player.eosID,
      name: raw.player.name,
      timestamp: raw.time.toISOString(),
    });
  };

  const handleDisconnected = (raw: SquadJSPlayerDisconnectedRaw) => {
    if (!raw.player) {
      opts.onUnmatchedPlayer?.(raw.eosID, 'PLAYER_DISCONNECTED');
      return;
    }
    onEvent({
      type: 'PLAYER_DISCONNECTED',
      serverSlug,
      steamId: raw.player.steamID,
      timestamp: raw.time.toISOString(),
    });
  };

  const handleChat = (raw: SquadJSChatMessageRaw) => {
    onEvent({
      type: 'CHAT_MESSAGE',
      serverSlug,
      steamId: raw.steamID,
      channel: CHAT_CHANNEL_MAP[raw.chat],
      message: raw.message,
      timestamp: raw.time.toISOString(),
    });
  };

  const handleNewGame = (raw: SquadJSNewGameRaw) => {
    // Okunabilir ad yoksa classname'e düşüyoruz: "Yehorivka_RAAS_v1" çirkin
    // ama boş bırakmaktan iyi — maçın hangi haritada oynandığı kaybolmasın.
    const layer = raw.layer?.name ?? raw.layerClassname;
    const map = raw.layer?.map?.name ?? raw.mapClassname;
    onEvent({
      type: 'ROUND_STARTED',
      serverSlug,
      ...(layer ? { layer } : {}),
      ...(map ? { map } : {}),
      timestamp: raw.time.toISOString(),
    });
  };

  const handleRoundEnded = (raw: SquadJSRoundEndedRaw) => {
    // Takım ve ticket log'dan string geliyor; sayıya çevrilemiyorsa alanı
    // hiç göndermiyoruz — sözleşme opsiyonel, uydurma değer yazmıyoruz.
    const team = Number(raw.winner?.team);
    const winnerTickets = Number(raw.winner?.tickets);
    const loserTickets = Number(raw.loser?.tickets);
    onEvent({
      type: 'ROUND_ENDED',
      serverSlug,
      ...(team === 1 || team === 2 ? { winnerTeam: team } : {}),
      ...(raw.winner?.faction ? { winnerFaction: raw.winner.faction } : {}),
      ...(Number.isFinite(winnerTickets) ? { winnerTickets } : {}),
      ...(raw.loser?.faction ? { loserFaction: raw.loser.faction } : {}),
      ...(Number.isFinite(loserTickets) ? { loserTickets } : {}),
      timestamp: raw.time.toISOString(),
    });
  };

  /**
   * En son görülen tick hızı.
   *
   * Kendi olayı olarak gönderilmiyor, snapshot'a bindiriliyor: log satırı
   * ~30 sn'de bir düşüyor ve her birini ayrı uplink mesajı yapmak dakikada
   * iki gereksiz yazma demekti. TPS yavaş değişen bir büyüklük, 60 sn'lik
   * snapshot ritmi yeterli.
   *
   * Yaşı da tutuluyor: sunucu kapalıyken son bilinen değeri "canlı" gibi
   * göstermek yanlış bilgi olurdu.
   */
  let sonTickRate: number | undefined;
  let sonTickZamani = 0;

  const handleTickRate = (raw: SquadJSTickRateRaw) => {
    if (!Number.isFinite(raw.tickRate)) return;
    sonTickRate = raw.tickRate;
    sonTickZamani = Date.now();
  };

  const handleSquadCreated = (raw: SquadJSSquadCreatedRaw) => {
    const ad = raw.player?.name?.trim();
    const squadId = raw.squadID === undefined || raw.squadID === null ? '' : String(raw.squadID);
    // Kim kurduğu bilinmiyorsa satırın anlamı kalmıyor; olayı üretmiyoruz.
    if (!ad || !squadId) return;
    const zaman = raw.time instanceof Date ? raw.time : new Date();
    onEvent({
      type: 'SQUAD_CREATED',
      serverSlug,
      playerName: ad,
      ...(raw.player?.steamID ? { steamId: raw.player.steamID } : {}),
      ...(raw.player?.eosID ? { eosId: raw.player.eosID } : {}),
      squadId,
      squadName: raw.squadName ?? `Squad ${squadId}`,
      ...(raw.teamName ? { teamName: raw.teamName } : {}),
      timestamp: zaman.toISOString(),
    });
  };

  async function takeSnapshot() {
    try {
      const status = await engine.getStatus();
      // Bayat tick hızı gönderilmiyor: log akışı durduysa (sunucu çöktü,
      // log dosyası döndü) son bilinen değer saatlerce "canlı" görünürdü.
      const tickTaze = sonTickRate !== undefined && Date.now() - sonTickZamani < TICK_TAZELIK_MS;
      onEvent({
        type: 'SERVER_SNAPSHOT',
        serverSlug,
        playerCount: status.playerCount,
        queueCount: status.publicQueue,
        layer: status.currentLayer,
        ...(tickTaze ? { tickRate: sonTickRate } : {}),
        timestamp: new Date().toISOString(),
      });
    } catch {
      // RCON geçici olarak yanıt vermiyor olabilir — snapshot atlanır,
      // bir sonraki interval'de tekrar denenir (reconciler bu tür boşlukları
      // log eventlerinden onarır, bkz. plan Bölüm 5).
    }
  }

  return {
    start() {
      engine.on('PLAYER_CONNECTED', handleConnected);
      engine.on('PLAYER_DISCONNECTED', handleDisconnected);
      engine.on('CHAT_MESSAGE', handleChat);
      engine.on('NEW_GAME', handleNewGame);
      engine.on('ROUND_ENDED', handleRoundEnded);
      engine.on('SQUAD_CREATED', handleSquadCreated);
      engine.on('TICK_RATE', handleTickRate);
      snapshotTimer = setInterval(takeSnapshot, snapshotIntervalMs);
      void takeSnapshot();
    },
    stop() {
      engine.off('PLAYER_CONNECTED', handleConnected);
      engine.off('PLAYER_DISCONNECTED', handleDisconnected);
      engine.off('CHAT_MESSAGE', handleChat);
      engine.off('NEW_GAME', handleNewGame);
      engine.off('ROUND_ENDED', handleRoundEnded);
      engine.off('SQUAD_CREATED', handleSquadCreated);
      engine.off('TICK_RATE', handleTickRate);
      if (snapshotTimer) clearInterval(snapshotTimer);
    },
  };
}
