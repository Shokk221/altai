import EventEmitter from 'events';

import Logger from 'core/logger';

import { Layers } from './layers/index.js';

import LogParser from './log-parser/index.js';
import Rcon from './rcon.js';

import { SQUADJS_VERSION } from './utils/constants.js';

import { isPlayerID, anyIDToPlayer, anyIDsToPlayers } from './utils/any-id.js';
import { playerIdNames } from 'core/id-parser';

// Faz 1'de admin listesi Discord RBAC'tan gelmiyor henüz (Faz 2, plan
// Bölüm 8) — eski Mongo tabanlı loadAdminsFromDB tamamen kaldırıldı, boş
// liste dönen bir stub'la değiştirildi. SquadServer bunu sadece admin-cam
// süre kurtarma ve (varsa) plugin'lerin admin kontrolü için kullanıyor;
// boş dönmesi log/rcon toplama işlevini etkilemez.
async function loadAdminsFromDB() {
  return {};
}

export default class SquadServer extends EventEmitter {
  constructor(options = {}) {
    super();

    for (const option of ['host'])
      if (!(option in options)) throw new Error(`${option} must be specified.`);

    this.id = options.id;
    this.options = options;

    this.layerHistory = [];
    this.layerHistoryMaxLength = options.layerHistoryMaxLength || 20;

    this.players = [];

    this.squads = [];

    this.admins = {};
    this.adminsInAdminCam = {};

    this.plugins = [];

    this.setupRCON();
    this.setupLogParser();

    this.updatePlayerList = this.updatePlayerList.bind(this);
    this.updatePlayerListInterval = 10 * 1000;
    this.updatePlayerListTimeout = null;

    this.updateSquadList = this.updateSquadList.bind(this);
    this.updateSquadListInterval = 10 * 1000;
    this.updateSquadListTimeout = null;

    this.updateLayerInformation = this.updateLayerInformation.bind(this);
    this.updateLayerInformationInterval = 30 * 1000;
    this.updateLayerInformationTimeout = null;

    this.updateA2SInformation = this.updateA2SInformation.bind(this);
    this.updateA2SInformationInterval = 30 * 1000;
    this.updateA2SInformationTimeout = null;
  }

  async watch() {
    Logger.verbose(
      'SquadServer',
      1,
      `Beginning to watch ${this.options.host}:${this.options.queryPort}...`
    );

    await Layers.pull();

    this.admins = await loadAdminsFromDB();

    await this.rcon.connect();
    await this.updateSquadList();
    await this.updatePlayerList(this);
    await this.updateLayerInformation();
    await this.updateA2SInformation();

    await this.logParser.watch();

    Logger.verbose('SquadServer', 1, `Watching ${this.serverName}...`);
  }

  async unwatch() {
    await this.rcon.disconnect();
    await this.logParser.unwatch();
  }

  setupRCON() {
    this.isConnecting = false; // Track connection state
    this.rcon = new Rcon({
      host: this.options.rconHost || this.options.host,
      port: this.options.rconPort,
      password: this.options.rconPassword,
      autoReconnectInterval: this.options.rconAutoReconnectInterval
    });

    // Handle connection events
    this.rcon.on('connect', () => {
      Logger.info('SquadServer', `Connected to RCON at ${this.options.rconHost}:${this.options.rconPort}`);
      this.isConnecting = false;
    });

    this.rcon.on('error', (err) => {
      Logger.error('SquadServer', `RCON connection error: ${err.message}`);
      this.isConnecting = false;
    });

    this.rcon.on('close', () => {
      Logger.warn('SquadServer', 'RCON connection closed.');
      this.isConnecting = false;
    });

    this.rcon.on('CHAT_MESSAGE', async (data) => {
      console.log(`[DEBUG-CHAT] RCON CHAT_MESSAGE received | Chat: ${data.chat} | Name: ${data.name} | Message: ${data.message} | EosID: ${data.eosID || 'N/A'} | SteamID: ${data.steamID || 'N/A'}`);
      data.player = await this.getPlayerByEOSID(data.eosID);

      // Fallback: eosID ile bulunamadıysa steamID veya isim ile dene
      if (!data.player) {
        if (data.steamID) {
          data.player = this.players.find(p => p.steamID === data.steamID);
          if (data.player) console.log(`[DEBUG-CHAT] Player resolved via steamID fallback: ${data.player.name}`);
        }
        if (!data.player && data.name) {
          data.player = this.players.find(p => p.name === data.name);
          if (data.player) console.log(`[DEBUG-CHAT] Player resolved via name fallback: ${data.player.name}`);
        }
        if (!data.player) {
          console.warn(`[DEBUG-CHAT] Player NOT FOUND for eosID: ${data.eosID} | Name: ${data.name} | Players in cache: ${this.players.length}`);
        }
      }
      this.emit('CHAT_MESSAGE', data);

      const command = data.message.match(/!([^ ]+) ?(.*)/);
      if (command) {
        console.log(`[DEBUG-CHAT] Emitting CHAT_COMMAND:${command[1].toLowerCase()} | Player: ${data.player?.name || 'NULL'} | SteamID: ${data.player?.steamID || 'NULL'}`);
        this.emit(`CHAT_COMMAND:${command[1].toLowerCase()}`, {
          ...data,
          message: command[2].trim()
        });
      }
    });

    this.rcon.on('POSSESSED_ADMIN_CAMERA', async (data) => {
      // Manga bilgisi kritik olduğu için forceUpdate: true yapıyoruz
      data.player = await this.getPlayerByEOSID(data.eosID, true);

      this.adminsInAdminCam[data.eosID] = data.time;

      console.log(`[DEBUG-ADMINCAM] SquadServer POSSESSED | Player: ${data.player?.name || 'null'} | SteamID: ${data.player?.steamID || 'null'} | EosID: ${data.eosID} | PlayerObj: ${data.player ? 'EXISTS' : 'NULL'}`);
      this.emit('POSSESSED_ADMIN_CAMERA', data);
    });

    this.rcon.on('UNPOSSESSED_ADMIN_CAMERA', async (data) => {
      // Çıkışta tam doğrulama için hem manga hem oyuncu listesini tazeleyelim
      await this.updateSquadList();
      await this.updatePlayerList();

      data.player = await this.getPlayerByEOSID(data.eosID);

      // Çapraz Kontrol: Oyuncunun mangası gerçekten var mı? (Kapatılmış olabilir)
      if (data.player && data.player.squadID) {
        const squadExists = this.squads.find(s => s.squadID === parseInt(data.player.squadID) && s.teamID === data.player.teamID);
        if (!squadExists) {
          data.player.squadID = null;
          data.player.squad = null;
        }
      }

      // ─── Duration Hesaplama (3 katmanlı recovery) ───
      data.duration = 0;

      // 1. In-memory POSSESSED kaydı (en güvenilir)
      if (this.adminsInAdminCam[data.eosID]) {
        data.duration = data.time.getTime() - this.adminsInAdminCam[data.eosID].getTime();
        console.log(`[DEBUG-ADMINCAM] SquadServer UNPOSSESSED | Duration from memory: ${Math.round(data.duration/60000)}min`);
      }

      // 2. Bellekte yoksa → DB'den son POSSESSED kaydını bul (sunucu restart recovery)
      //    TODO(Faz 6): admin_cam_logs tablosu Postgres'te henüz yok (plan
      //    Bölüm 4/6, admin cam watchlist özelliğiyle birlikte gelecek).
      //    O zamana kadar bu katman atlanır, layer 3 "kayıp session" olarak loglar.

      // 3. Negatif veya sıfır duration → kayıp session olarak logla
      if (data.duration <= 0) {
        console.warn(`[DEBUG-ADMINCAM] SquadServer UNPOSSESSED | Duration=0 (kayıp session) | Player: ${data.player?.name || 'null'} | EosID: ${data.eosID}`);
      }

      delete this.adminsInAdminCam[data.eosID];

      // Loglama (seeding/training durumu bilgi amaçlı)
      const isSeeding = this.a2sPlayerCount > 0 && this.a2sPlayerCount < 50;
      const gamemode = (this.currentLayer?.gamemode || '').toLowerCase();
      const isTraining = gamemode === 'training';
      if (isSeeding || isTraining) {
        console.log(`[DEBUG-ADMINCAM] SquadServer UNPOSSESSED | SEEDING/TRAINING (seeding=${isSeeding}, training=${isTraining}, gamemode=${gamemode}, players=${this.a2sPlayerCount}) | Player: ${data.player?.name || 'null'} | Duration: ${data.duration}ms (kaydediliyor)`);
      } else {
        console.log(`[DEBUG-ADMINCAM] SquadServer UNPOSSESSED | Player: ${data.player?.name || 'null'} | SteamID: ${data.player?.steamID || 'null'} | EosID: ${data.eosID} | Duration: ${data.duration}ms | PlayerObj: ${data.player ? 'EXISTS' : 'NULL'}`);
      }
      this.emit('UNPOSSESSED_ADMIN_CAMERA', data);
    });

    this.rcon.on('RCON_ERROR', (data) => {
      this.emit('RCON_ERROR', data);
    });

    this.rcon.on('PLAYER_WARNED', async (data) => {
      data.player = await this.getPlayerByName(data.name);

      this.emit('PLAYER_WARNED', data);
    });

    this.rcon.on('PLAYER_KICKED', async (data) => {
      data.player = await this.getPlayerByEOSID(data.eosID);

      this.emit('PLAYER_KICKED', data);
    });

    this.rcon.on('PLAYER_BANNED', async (data) => {
      data.player = await this.getPlayerByEOSID(data.eosID);

      this.emit('PLAYER_BANNED', data);
    });

    this.rcon.on('SQUAD_CREATED', async (data) => {
      // Önce normal şekilde işle
      data.player = await this.getPlayerByEOSID(data.playerEOSID, true);
      data.player.squadID = data.squadID;

      // ÖNEMLİ: Oyuncunun manga bilgisini hafızadaki (this.players) listesine manuel işle
      // Böylece sonraki olaylarda (Admin Cam vb.) güncel bilgi görünür.
      const cachedPlayer = this.players.find(p => p.eosID === data.playerEOSID);
      if (cachedPlayer) {
        cachedPlayer.squadID = parseInt(data.squadID);
        cachedPlayer.squadName = data.squadName;
        cachedPlayer.isLeader = true;
        // Takım bilgisini de güncelle
        // data.teamName logdan geliyor ama ID'yi çevirmek gerekebilir, şimdilik ID kalsın
      }

      delete data.playerName;
      for (const k in data) if (k.startsWith('player') && k.endsWith('ID')) delete data[k];

      this.emit('SQUAD_CREATED', data);
    });
  }

  async restartRCON() {
    try {
      await this.rcon.disconnect();
    } catch (err) {
      Logger.verbose('SquadServer', 1, 'Failed to stop RCON instance when restarting.', err);
    }

    Logger.verbose('SquadServer', 1, 'Setting up new RCON instance...');
    this.setupRCON();
    await this.rcon.connect();
  }

  setupLogParser() {
    this.logParser = new LogParser({
      mode: this.options.logReaderMode,
      logDir: this.options.logDir,
      sftp: this.options.sftp,
      ftp: this.options.ftp
    });

    this.logParser.on('ADMIN_BROADCAST', (data) => {
      this.emit('ADMIN_BROADCAST', data);
    });

    this.logParser.on('DEPLOYABLE_DAMAGED', async (data) => {
      data.player = await this.getPlayerByNameSuffix(data.playerSuffix);

      delete data.playerSuffix;

      this.emit('DEPLOYABLE_DAMAGED', data);
    });

    this.logParser.on('NEW_GAME', async (data) => {
      data.layer = await Layers.getLayerByClassname(data.layerClassname);

      this.layerHistory.unshift({ layer: data.layer, time: data.time });
      this.layerHistory = this.layerHistory.slice(0, this.layerHistoryMaxLength);

      this.currentLayer = data.layer;
      await this.updateAdmins();
      this.emit('NEW_GAME', data);
    });

    this.logParser.on('JOIN_SUCCEEDED', async (data) => {
      Logger.verbose(
        'SquadServer',
        1,
        `Player connected ${data.playerSuffix} - SteamID: ${data.steamID} - EOSID: ${data.eosID} - IP: ${data.ip}`
      );

      data.player = await this.getPlayerByEOSID(data.eosID);
      if (data.player) data.player.suffix = data.playerSuffix;

      for (const k in data) if (playerIdNames.includes(k)) delete data[k];
      delete data.playerSuffix;

      this.emit('PLAYER_CONNECTED', data);
    });

    this.logParser.on('PLAYER_DISCONNECTED', async (data) => {
      data.player = await this.getPlayerByEOSID(data.eosID);

      // Admin cam açıkken disconnect olursa → UNPOSSESSED kaydı oluştur (süre kaybını önle)
      if (data.eosID && this.adminsInAdminCam[data.eosID]) {
        const camStartTime = this.adminsInAdminCam[data.eosID];
        const disconnectTime = data.time || new Date();
        const duration = disconnectTime.getTime ? disconnectTime.getTime() - camStartTime.getTime() : Date.now() - camStartTime.getTime();
        delete this.adminsInAdminCam[data.eosID];

        console.log(`[DEBUG-ADMINCAM] SquadServer DISCONNECT-WHILE-IN-CAM | Player: ${data.player?.name || data.eosID} | Duration: ${Math.round(duration/60000)}min | Creating synthetic UNPOSSESSED`);

        // Sentetik UNPOSSESSED event emit et → DB'ye kaydedilir
        this.emit('UNPOSSESSED_ADMIN_CAMERA', {
          player: data.player,
          eosID: data.eosID,
          time: disconnectTime,
          duration: duration
        });
      }

      for (const k in data) if (playerIdNames.includes(k)) delete data[k];

      this.emit('PLAYER_DISCONNECTED', data);
    });

    this.logParser.on('PLAYER_DAMAGED', async (data) => {
      // Parallel lookups for faster resolution
      const [victim, attacker] = await Promise.all([
        this.getPlayerByName(data.victimName),
        this.getPlayerByEOSID(data.attackerEOSID)
      ]);
      data.victim = victim;
      data.attacker = attacker;

      if (data.attacker && !data.attacker.playercontroller && data.attackerController)
        data.attacker.playercontroller = data.attackerController;

      if (data.victim && data.attacker) {
        data.teamkill =
          data.victim.teamID === data.attacker.teamID && data.victim.eosID !== data.attacker.eosID;
      }

      delete data.victimName;
      delete data.attackerName;

      this.emit('PLAYER_DAMAGED', data);
    });

    this.logParser.on('PLAYER_WOUNDED', async (data) => {
      // Parallel lookups for faster resolution
      const [victim, attacker] = await Promise.all([
        this.getPlayerByName(data.victimName),
        this.getPlayerByEOSID(data.attackerEOSID)
      ]);
      data.victim = victim;
      data.attacker = attacker;
      if (!data.attacker)
        data.attacker = await this.getPlayerByController(data.attackerPlayerController);

      if (data.victim && data.attacker)
        data.teamkill =
          data.victim.teamID === data.attacker.teamID && data.victim.eosID !== data.attacker.eosID;

      delete data.victimName;
      delete data.attackerName;

      this.emit('PLAYER_WOUNDED', data);
      if (data.teamkill) this.emit('TEAMKILL', data);
    });

    this.logParser.on('PLAYER_DIED', async (data) => {
      // Parallel lookups for faster resolution
      const [victim, attacker] = await Promise.all([
        this.getPlayerByName(data.victimName),
        this.getPlayerByEOSID(data.attackerEOSID)
      ]);
      data.victim = victim;
      data.attacker = attacker;
      if (!data.attacker)
        data.attacker = await this.getPlayerByController(data.attackerPlayerController);

      if (data.victim && data.attacker)
        data.teamkill =
          data.victim.teamID === data.attacker.teamID && data.victim.eosID !== data.attacker.eosID;

      delete data.victimName;
      delete data.attackerName;

      this.emit('PLAYER_DIED', data);
    });

    this.logParser.on('PLAYER_REVIVED', async (data) => {
      // Parallel lookups instead of sequential (3x faster resolution)
      const [victim, attacker, reviver] = await Promise.all([
        this.getPlayerByEOSID(data.victimEOSID),
        this.getPlayerByEOSID(data.attackerEOSID),
        this.getPlayerByEOSID(data.reviverEOSID)
      ]);
      data.victim = victim;
      data.attacker = attacker;
      data.reviver = reviver;

      delete data.victimName;
      delete data.attackerName;
      delete data.reviverName;

      this.emit('PLAYER_REVIVED', data);
    });

    this.logParser.on('PLAYER_POSSESS', async (data) => {
      data.player = await this.getPlayerByEOSID(data.playerEOSID);
      if (data.player) data.player.possessClassname = data.possessClassname;

      delete data.playerSuffix;

      this.emit('PLAYER_POSSESS', data);
    });

    this.logParser.on('PLAYER_UNPOSSESS', async (data) => {
      data.player = await this.getPlayerByEOSID(data.playerEOSID);

      delete data.playerSuffix;

      this.emit('PLAYER_UNPOSSESS', data);
    });

    this.logParser.on('ROUND_ENDED', async (data) => {
      this.emit('ROUND_ENDED', data);
    });

    this.logParser.on('TICK_RATE', (data) => {
      this.emit('TICK_RATE', data);
    });
  }

  async restartLogParser() {
    try {
      await this.logParser.unwatch();
    } catch (err) {
      Logger.verbose('SquadServer', 1, 'Failed to stop LogParser instance when restarting.', err);
    }

    Logger.verbose('SquadServer', 1, 'Setting up new LogParser instance...');
    this.setupLogParser();
    await this.logParser.watch();
  }

  /**
   * @deprecated Kept for backwards compatibility with custom plugins.
   */
  getAdminPermsBySteamID(steamID) {
    return this.getAdminPermsByAnyID(steamID);
  }

  getAdminPermsByAnyID(anyID) {
    // using this.players directly to keep the function sync
    const player = anyIDToPlayer(anyID, this.players);
    if (player === undefined) return;
    for (const idName of playerIdNames)
      if (player[idName] in this.admins) return this.admins[player[idName]];
  }

  /**
   * Get ids of every admin that has the permission.
   * @overload
   * @arg {string} perm - permission to filter with.
   * @arg {('steamID'|'eosID'|'anyID')} type - return IDs of selected
   *   type. For <code>'steamID'</code> returns all matching steam IDs
   *   from admins lists plus maps online admins from eosIDs to steamIDs
   *   if both IDs are provided (and vice versa for
   *   <code>'eosID'</code>). For <code>'anyID'</code> returns both
   *   steam and eos IDs as is, no remapping applied.
   * @returns {string[]}
   */ /**
  * Get every admin that has the permission.
  * @overload
  * @arg {string} perm - permission to filter with.
  * @arg {'player'} type - return players instead of just IDs. Returns
  *   only admins that are online.
  * @returns {Player[]}
  */ /**
  * Get steamIDs of every admin that has the permission. This overload
  * exists for compatibility with pre-EOS API and is equivalent to
  * <code>getAdminsWithPermisson(perm, type='steamID')</code>.
  * @overload
  * @arg {string} perm - permission to filter with.
  * @returns {string[]}
  */
  getAdminsWithPermission(perm, type = 'steamID') {
    const steamRgx = /^\d{17}$/;
    const ret = [];
    for (const [anyID, perms] of Object.entries(this.admins)) {
      if (perm in perms) ret.push(anyID);
    }
    let filter = (ID) => ID.match(steamRgx) !== null; // true if steamID
    switch (type) {
      // 1) if admin is registered with steamID and is online then swap to eosID
      // 2) deduplicate output in case same admin was in 2 lists with different IDs
      case 'anyID':
        return [
          ...new Set(
            ret.map((ID) => {
              for (const adm of this.players) {
                if (isPlayerID(ID, adm)) return adm.eosID;
              }
              return ID;
            })
          )
        ];
      case 'player':
        return anyIDsToPlayers(ret, this.players);
      case 'eosID': {
        filter = (ID) => ID.match(steamRgx) === null;
        break;
      }
      case 'steamID':
        break;
      default:
        throw new Error(`Expected type == 'steamID'|'eosID'|'anyID'|'player', got '${type}'.`);
    }
    const matches = [];
    const fails = [];
    ret.forEach((ID) => (filter(ID) ? matches : fails).push(ID));
    if (fails.length) {
      const remappedIDs = anyIDsToPlayers(fails, this.players).map((player) => player[type]);
      // deduplicate output after remapping
      return [...new Set(matches.concat(remappedIDs))];
    }
    return matches;
  }

  async updateAdmins() {
    this.admins = await loadAdminsFromDB();
  }

  async updatePlayerList() {
    if (this.updatePlayerListTimeout) clearTimeout(this.updatePlayerListTimeout);

    // RCON kontrolü ekle (Eğer isConnected metodu yoksa try-catch yeterli olmalı ama garanti olsun)
    // Rcon sınıfının internals'ına erişimimiz sınırlı olabilir, bu yüzden try-catch ile devam edelim
    // ama hatayı sadece loglayalım, fırlatmayalım.

    Logger.verbose('SquadServer', 4, `Updating player list...`);

    try {
      const playersList = await this.rcon.getListPlayers(this);
      if (!playersList) throw new Error("Failed to retrieve player list");

      const oldPlayerInfo = {};
      for (const player of this.players) {
        oldPlayerInfo[player.eosID] = player;
      }

      const players = [];
      for (const player of playersList)
        players.push({
          ...oldPlayerInfo[player.eosID],
          ...player,
          playercontroller: this.logParser.eventStore.players[player.eosID]
            ? this.logParser.eventStore.players[player.eosID].controller
            : null,
          squad: await this.getSquadByID(player.teamID, player.squadID)
        });

      this.players = players;

      for (const player of this.players) {
        const oldInfo = oldPlayerInfo[player.eosID];
        if (oldInfo === undefined) continue;
        if (player.teamID !== oldInfo.teamID)
          this.emit('PLAYER_TEAM_CHANGE', {
            player: player,
            oldTeamID: oldInfo.teamID,
            newTeamID: player.teamID
          });
        if (player.squadID !== oldInfo.squadID)
          this.emit('PLAYER_SQUAD_CHANGE', {
            player: player,
            oldSquadID: oldInfo.squadID,
            newSquadID: player.squadID
          });
        // Patched: Role change detection
        if (player.role !== oldInfo.role) {
          this.emit('PLAYER_ROLE_CHANGE', {
            player: player,
            oldRole: oldInfo.role,
            newRole: player.role
          });
        }
        // Patched: Leader status change detection
        if (player.isLeader && oldInfo.isLeader === false) {
          this.emit('PLAYER_NOW_IS_LEADER', {
            player: player,
            oldSquadID: oldInfo.squadID,
            newSquadID: player.squadID
          });
        }
        if (player.isLeader === false && oldInfo.isLeader) {
          this.emit('PLAYER_NOW_IS_NOT_LEADER', {
            player: player,
            oldSquadID: oldInfo.squadID,
            newSquadID: player.squadID
          });
        }
      }

      if (this.a2sPlayerCount > 0 && players.length === 0)
        Logger.verbose(
          'SquadServer',
          1,
          `Real Player Count: ${this.a2sPlayerCount} but loaded ${players.length}`
        );

      this.emit('UPDATED_PLAYER_INFORMATION');

      // Admin Cam Stale Entry Cleanup:
      // Oyuncu listesinde olmayan ama adminsInAdminCam'de kalan kayıtları temizle.
      // Bu durum oyuncu unpossess yapmadan disconnect olduğunda ve PLAYER_DISCONNECTED
      // log event'i yakalanamadığında (crash, alt+F4, timeout vs.) oluşur.
      const currentEosIDs = new Set(this.players.map(p => p.eosID));
      for (const [eosID, startTime] of Object.entries(this.adminsInAdminCam)) {
        if (!currentEosIDs.has(eosID)) {
          const now = new Date();
          const duration = now.getTime() - new Date(startTime).getTime();
          delete this.adminsInAdminCam[eosID];

          console.log(`[DEBUG-ADMINCAM] STALE CAM CLEANUP | EosID: ${eosID} | Duration: ${Math.round(duration / 60000)}min | Player no longer in server`);

          // Sentetik UNPOSSESSED event oluştur → DB'ye kaydedilir
          this.emit('UNPOSSESSED_ADMIN_CAMERA', {
            player: await this.getPlayerByEOSID(eosID),
            eosID: eosID,
            time: now,
            duration: duration
          });
        }
      }
    } catch (err) {
      Logger.verbose('SquadServer', 1, 'Failed to update player list.', err.message);
    }

    Logger.verbose('SquadServer', 4, `Updated player list.`);

    this.updatePlayerListTimeout = setTimeout(this.updatePlayerList, this.updatePlayerListInterval);
  }

  async updateSquadList() {
    if (this.updateSquadListTimeout) clearTimeout(this.updateSquadListTimeout);

    Logger.verbose('SquadServer', 4, `Updating squad list...`);

    try {
      this.squads = await this.rcon.getSquads();
    } catch (err) {
      Logger.verbose('SquadServer', 1, 'Failed to update squad list.', err);
    }

    Logger.verbose('SquadServer', 4, `Updated squad list.`);

    this.updateSquadListTimeout = setTimeout(this.updateSquadList, this.updateSquadListInterval);
  }

  async updateLayerInformation() {
    if (this.updateLayerInformationTimeout) clearTimeout(this.updateLayerInformationTimeout);

    Logger.verbose('SquadServer', 4, `Updating layer information...`);

    try {
      const currentMap = await this.rcon.getCurrentMap();
      const nextMap = await this.rcon.getNextMap();
      const nextMapToBeVoted = nextMap.layer === 'To be voted';

      const currentLayer = await Layers.getLayerById(currentMap.layer);
      const nextLayer = nextMapToBeVoted ? null : await Layers.getLayerById(nextMap.layer);

      if (this.layerHistory.length === 0) {
        this.layerHistory.unshift({ layer: currentLayer, time: Date.now() });
        this.layerHistory = this.layerHistory.slice(0, this.layerHistoryMaxLength);
      }

      this.currentLayer = currentLayer;
      this.nextLayer = nextLayer;
      this.nextLayerToBeVoted = nextMapToBeVoted;

      // Store raw RCON strings as fallback (for when Layer object isn't found in wiki data)
      this.currentLayerRaw = currentMap.layer || null;
      this.currentLevelRaw = currentMap.level || null;

      this.emit('UPDATED_LAYER_INFORMATION');
    } catch (err) {
      Logger.verbose('SquadServer', 1, 'Failed to update layer information.', err);
    }

    Logger.verbose('SquadServer', 4, `Updated layer information.`);

    this.updateLayerInformationTimeout = setTimeout(
      this.updateLayerInformation,
      this.updateLayerInformationInterval
    );
  }

  updateA2SInformation() {
    return this.updateServerInformation();
  }

  async updateServerInformation() {
    if (this.updateA2SInformationTimeout) clearTimeout(this.updateA2SInformationTimeout);

    Logger.verbose('SquadServer', 4, `Updating server information...`);

    try {
      const rawData = await this.rcon.execute(`ShowServerInfo`);
      Logger.verbose('SquadServer', 3, `Server information raw data`, rawData);
      const data = JSON.parse(rawData);
      Logger.verbose('SquadServer', 2, `Server information data`, JSON.data);

      const info = {
        raw: data,
        serverName: data.ServerName_s,

        maxPlayers: parseInt(data.MaxPlayers),
        publicQueueLimit: parseInt(data.PublicQueueLimit_I),
        reserveSlots: parseInt(data.PlayerReserveCount_I),

        playerCount: parseInt(data.PlayerCount_I),
        a2sPlayerCount: parseInt(data.PlayerCount_I),
        publicQueue: parseInt(data.PublicQueue_I),
        reserveQueue: parseInt(data.ReservedQueue_I),

        currentLayer: data.MapName_s,
        nextLayer: data.NextLayer_s,

        teamOne: data.TeamOne_s?.replace(new RegExp(data.MapName_s, 'i'), '') || '',
        teamTwo: data.TeamTwo_s?.replace(new RegExp(data.MapName_s, 'i'), '') || '',

        matchTimeout: parseFloat(data.MatchTimeout_d),
        matchStartTime: this.getMatchStartTimeByPlaytime(data.PLAYTIME_I),
        gameVersion: data.GameVersion_s
      };

      this.serverName = info.serverName;

      this.maxPlayers = info.maxPlayers;
      this.publicSlots = info.maxPlayers - info.reserveSlots;
      this.reserveSlots = info.reserveSlots;

      this.a2sPlayerCount = info.playerCount;
      this.playerCount = info.playerCount;
      this.publicQueue = info.publicQueue;
      this.reserveQueue = info.reserveQueue;

      this.matchTimeout = info.matchTimeout;
      this.matchStartTime = info.matchStartTime;
      this.gameVersion = info.gameVersion;

      if (!this.currentLayer) this.currentLayer = Layers.getLayerByClassname(info.currentLayer);
      if (!this.nextLayer) this.nextLayer = Layers.getLayerByClassname(info.nextLayer);

      this.emit('UPDATED_A2S_INFORMATION', info);
      this.emit('UPDATED_SERVER_INFORMATION', info);
    } catch (err) {
      Logger.verbose('SquadServer', 1, 'Failed to update server information.', err);
    }

    Logger.verbose('SquadServer', 4, `Updated server information.`);

    this.updateA2SInformationTimeout = setTimeout(
      this.updateA2SInformation,
      this.updateA2SInformationInterval
    );
  }

  async getPlayerByCondition(condition, forceUpdate = false, retry = true) {
    let matches;

    if (!forceUpdate) {
      matches = this.players.filter(condition);
      if (matches.length === 1) return matches[0];

      if (!retry) return null;
    }

    await this.updatePlayerList();

    matches = this.players.filter(condition);
    if (matches.length === 1) return matches[0];

    return null;
  }

  async getSquadByCondition(condition, forceUpdate = false, retry = true) {
    let matches;

    if (!forceUpdate) {
      matches = this.squads.filter(condition);
      if (matches.length === 1) return matches[0];

      if (!retry) return null;
    }

    await this.updateSquadList();

    matches = this.squads.filter(condition);
    if (matches.length === 1) return matches[0];

    return null;
  }

  async getSquadByID(teamID, squadID) {
    if (squadID === null) return null;
    return this.getSquadByCondition(
      (squad) => squad.teamID === teamID && squad.squadID === squadID
    );
  }

  /**
   * @deprecated Kept for backwards compatibility with custom plugins.
   */
  async getPlayerBySteamID(steamID, forceUpdate) {
    return this.getPlayerByCondition((player) => player.steamID === steamID, forceUpdate);
  }

  async getPlayerByEOSID(eosID, forceUpdate) {
    return this.getPlayerByCondition((player) => player.eosID === eosID, forceUpdate);
  }

  async getPlayerByAnyID(anyID, forceUpdate) {
    return this.getPlayerByCondition(
      (player) =>
        Object.entries(player).filter(([parm, val]) => parm.endsWith('ID') && val === anyID).length,
      forceUpdate
    );
  }

  async getPlayerByName(name, forceUpdate) {
    return this.getPlayerByCondition((player) => player.name === name, forceUpdate);
  }

  async getPlayerByNameSuffix(suffix, forceUpdate) {
    return this.getPlayerByCondition((player) => player.suffix === suffix, forceUpdate, false);
  }

  async getPlayerByController(controller, forceUpdate) {
    return this.getPlayerByCondition(
      (player) => player.playercontroller === controller,
      forceUpdate
    );
  }

  getMatchStartTimeByPlaytime(playtime) {
    return new Date(Date.now() - +playtime * 1000);
  }
}
