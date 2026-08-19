import type { AgentEvent } from '@altai/contracts';
import type {
  SquadJSAdminActionRaw,
  SquadJSChatMessageRaw,
  SquadJSEngine,
  SquadJSNewGameRaw,
  SquadJSPlayerConnectedRaw,
  SquadJSPlayerDamagedRaw,
  SquadJSPlayerDiedRaw,
  SquadJSPlayerDisconnectedRaw,
  SquadJSPlayerRevivedRaw,
  SquadJSPlayerStateChangeRaw,
  SquadJSRoundEndedRaw,
  SquadJSSquadCreatedRaw,
  SquadJSTeamkillRaw,
  SquadJSTickRateRaw,
} from './engine.js';
import { type SkorbordOzeti, macSkorborduOlustur, satirlariTazele } from './scoreboard.js';

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

  /**
   * Maç içi skorbord (plan Faz 4).
   *
   * Agent'ın belleğinde duruyor ve maç sonunda ROUND_ENDED'ın içine
   * biniyor. Agent maç ortasında yeniden başlarsa o maçın skorbordu
   * kayboluyor — bilinçli sınır: ara durumu diske yazmak, sürekli I/O
   * karşılığında yılda birkaç maçlık veri kurtarırdı.
   */
  const skorbord = macSkorborduOlustur();

  const handleDied = (raw: SquadJSPlayerDiedRaw) => skorbord.olum(raw);
  const handleRevived = (raw: SquadJSPlayerRevivedRaw) => skorbord.canlandirma(raw);
  const handleDamaged = (raw: SquadJSPlayerDamagedRaw) => skorbord.hasar(raw);

  const handleNewGame = (raw: SquadJSNewGameRaw) => {
    // Okunabilir ad yoksa classname'e düşüyoruz: "Yehorivka_RAAS_v1" çirkin
    // ama boş bırakmaktan iyi — maçın hangi haritada oynandığı kaybolmasın.
    const layer = raw.layer?.name ?? raw.layerClassname;
    const map = raw.layer?.map?.name ?? raw.mapClassname;
    // Yeni maç = temiz skorbord. ROUND_ENDED hiç düşmediyse (sunucu çöktü,
    // log döndü) önceki maçın sayaçları buraya sızardı ve iki maçın
    // istatistiği tek maça yazılırdı.
    skorbord.sifirla();
    onEvent({
      type: 'ROUND_STARTED',
      serverSlug,
      ...(layer ? { layer } : {}),
      ...(map ? { map } : {}),
      timestamp: raw.time.toISOString(),
    });
  };

  const handleRoundEnded = (raw: SquadJSRoundEndedRaw) => {
    // Skorbord ÖNCE ve SENKRON kapatılıyor. Aşağıdaki oyuncu listesi
    // sorgusu await gerektiriyor ve o sırada NEW_GAME düşerse sifirla()
    // maçın tüm istatistiğini silerdi.
    const ozet = skorbord.bitir();
    // takeSnapshot ile aynı duruş: onEvent'in kendi hatası adapter'ı
    // devirmemeli. Yakalanmayan bir reddetme burada tüm agent'ı düşürürdü.
    void roundEndedGonder(raw, ozet).catch(() => {});
  };

  async function roundEndedGonder(raw: SquadJSRoundEndedRaw, ozet: SkorbordOzeti) {
    // Maç sonundaki takım/manga/rol bilgisi yalnızca RCON listesinde var.
    // Alınamazsa satırlar maç içinde son görülen değerlerle gidiyor —
    // eksik alan yüzünden tüm skorbordu düşürmek çok daha pahalı olurdu.
    let satirlar = ozet.satirlar;
    try {
      satirlar = satirlariTazele(satirlar, await engine.getPlayers());
    } catch {
      // RCON yanıt vermiyor; elimizdekiyle devam.
    }

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
      // Boş skorbord GÖNDERİLMİYOR: alanın yokluğu "bu maçın istatistiği
      // yok" (agent maç ortasında başladı) demek; boş dizi ise "maçta hiç
      // oyuncu yoktu" demek olurdu ve ikisi farklı şeyler.
      ...(satirlar.length > 0 ? { players: satirlar } : {}),
      ...(ozet.atlananOlum > 0 ? { skippedDeaths: ozet.atlananOlum } : {}),
      timestamp: raw.time.toISOString(),
    });
  }

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

  /**
   * Yetkili işlemlerinin altısı da aynı biçime dönüşüyor; tek fark
   * `action` alanı. Alanlar YALNIZCA doluysa ekleniyor: sözleşmede hepsi
   * opsiyonel ve boş string göndermek "adı boş olan oyuncu" demek olurdu.
   */
  const yetkiliIslemi =
    (action: 'warn' | 'kick' | 'ban' | 'broadcast' | 'cam_enter' | 'cam_exit') =>
    (raw: SquadJSAdminActionRaw) => {
      const ad = raw.name?.trim();
      // Uyarıda metin `reason` alanında, duyuruda `message` alanında geliyor.
      const metin = (raw.message ?? raw.reason)?.trim();
      const zaman = raw.time instanceof Date ? raw.time : new Date();
      onEvent({
        type: 'ADMIN_ACTION',
        serverSlug,
        action,
        ...(ad ? { playerName: ad } : {}),
        ...(raw.steamID ? { steamId: raw.steamID } : {}),
        ...(raw.eosID ? { eosId: raw.eosID } : {}),
        ...(metin ? { message: metin } : {}),
        ...(raw.interval ? { interval: raw.interval } : {}),
        timestamp: zaman.toISOString(),
      });
    };

  const handleWarned = yetkiliIslemi('warn');
  const handleKicked = yetkiliIslemi('kick');
  const handleBanned = yetkiliIslemi('ban');
  const handleBroadcast = yetkiliIslemi('broadcast');
  const handleCamEnter = yetkiliIslemi('cam_enter');
  const handleCamExit = yetkiliIslemi('cam_exit');

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
      // RCON satırı yalnızca takım ADINI veriyor; sayısal kimlik çözümlenmiş
      // oyuncu kaydından geliyor. Manga dağıtan plugin'lerin tek kaynağı bu.
      ...(typeof raw.player?.teamID === 'number' ? { teamId: raw.player.teamID } : {}),
      timestamp: zaman.toISOString(),
    });
  };

  /**
   * Oyuncu durumu diff'leri (rol / manga / liderlik).
   *
   * Dördü de aynı şekle sahip olduğu için tek üretici; hangi değişiklik
   * olduğu `change` ile ayrışıyor.
   */
  const durumDegisimi =
    (change: 'role' | 'squad' | 'became_leader' | 'lost_leader') =>
    (raw: SquadJSPlayerStateChangeRaw) => {
      const p = raw.player;
      // Kimliksiz bir diff'in hiçbir plugin için değeri yok.
      if (!p || (!p.steamID && !p.eosID)) return;
      const zaman = raw.time instanceof Date ? raw.time : new Date();
      onEvent({
        type: 'PLAYER_STATE_CHANGE',
        serverSlug,
        change,
        ...(p.steamID ? { steamId: p.steamID } : {}),
        ...(p.eosID ? { eosId: p.eosID } : {}),
        playerName: p.name,
        ...(typeof p.teamID === 'number' ? { teamId: p.teamID } : {}),
        ...(typeof p.squadID === 'number' ? { squadId: p.squadID } : {}),
        isLeader: p.isLeader === true,
        ...(p.role ? { role: p.role } : {}),
        ...(raw.oldRole ? { oldRole: raw.oldRole } : {}),
        ...(typeof raw.oldSquadID === 'number' ? { oldSquadId: raw.oldSquadID } : {}),
        timestamp: zaman.toISOString(),
      });
    };

  const handleRoleChange = durumDegisimi('role');
  const handleSquadChange = durumDegisimi('squad');
  const handleBecameLeader = durumDegisimi('became_leader');
  const handleLostLeader = durumDegisimi('lost_leader');

  const handleTeamkill = (raw: SquadJSTeamkillRaw) => {
    // Kurban ve saldırganın ikisi de yoksa olay hiçbir şey anlatmıyor.
    if (!raw.victim && !raw.attacker) return;
    const zaman = raw.time instanceof Date ? raw.time : new Date();
    onEvent({
      type: 'TEAMKILL',
      serverSlug,
      ...(raw.attacker?.name ? { attackerName: raw.attacker.name } : {}),
      ...(raw.attacker?.steamID ? { attackerSteamId: raw.attacker.steamID } : {}),
      ...(raw.attacker?.eosID ? { attackerEosId: raw.attacker.eosID } : {}),
      ...(raw.victim?.name ? { victimName: raw.victim.name } : {}),
      ...(raw.victim?.steamID ? { victimSteamId: raw.victim.steamID } : {}),
      ...(raw.victim?.eosID ? { victimEosId: raw.victim.eosID } : {}),
      ...(raw.weapon ? { weapon: raw.weapon } : {}),
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
      engine.on('PLAYER_WARNED', handleWarned);
      engine.on('PLAYER_KICKED', handleKicked);
      engine.on('PLAYER_BANNED', handleBanned);
      engine.on('ADMIN_BROADCAST', handleBroadcast);
      engine.on('POSSESSED_ADMIN_CAMERA', handleCamEnter);
      engine.on('UNPOSSESSED_ADMIN_CAMERA', handleCamExit);
      engine.on('PLAYER_ROLE_CHANGE', handleRoleChange);
      engine.on('PLAYER_SQUAD_CHANGE', handleSquadChange);
      engine.on('PLAYER_NOW_IS_LEADER', handleBecameLeader);
      engine.on('PLAYER_NOW_IS_NOT_LEADER', handleLostLeader);
      engine.on('TEAMKILL', handleTeamkill);
      engine.on('PLAYER_DIED', handleDied);
      engine.on('PLAYER_REVIVED', handleRevived);
      engine.on('PLAYER_DAMAGED', handleDamaged);
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
      engine.off('PLAYER_WARNED', handleWarned);
      engine.off('PLAYER_KICKED', handleKicked);
      engine.off('PLAYER_BANNED', handleBanned);
      engine.off('ADMIN_BROADCAST', handleBroadcast);
      engine.off('POSSESSED_ADMIN_CAMERA', handleCamEnter);
      engine.off('UNPOSSESSED_ADMIN_CAMERA', handleCamExit);
      engine.off('PLAYER_ROLE_CHANGE', handleRoleChange);
      engine.off('PLAYER_SQUAD_CHANGE', handleSquadChange);
      engine.off('PLAYER_NOW_IS_LEADER', handleBecameLeader);
      engine.off('PLAYER_NOW_IS_NOT_LEADER', handleLostLeader);
      engine.off('TEAMKILL', handleTeamkill);
      engine.off('PLAYER_DIED', handleDied);
      engine.off('PLAYER_REVIVED', handleRevived);
      engine.off('PLAYER_DAMAGED', handleDamaged);
      if (snapshotTimer) clearInterval(snapshotTimer);
    },
  };
}
