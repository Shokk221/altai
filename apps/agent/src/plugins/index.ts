import type { AnyPlugin } from '@altai/squad';
import { adminCamVoice } from './admin-cam-voice.js';
import { adminCamWatchlist } from './admin-cam-watchlist.js';
import { adminRequest } from './admin-request.js';
import { autoKickUnassigned } from './auto-kick-unassigned.js';
import { autoSeedScheduler } from './auto-seed-scheduler.js';
import { autoTkWarn } from './auto-tk-warn.js';
import { broadcasts } from './broadcasts.js';
import { cblInfo } from './cbl-info.js';
import { chatCommands } from './chat-commands.js';
import { clanWarEnforcer } from './clan-war-enforcer.js';
import { eliteCommander } from './elite-commander.js';
import { fogOfWar } from './fog-of-war.js';
import { myStats } from './my-stats.js';
import { nameEnforcer } from './name-enforcer.js';
import { playtimeSquadGuard } from './playtime-squad-guard.js';
import { roundScoreboard } from './round-scoreboard.js';
import { rules } from './rules.js';
import { seedTracker } from './seed-tracker.js';
import { seedingMode } from './seeding-mode.js';
import { slBanEnforcer } from './sl-ban-enforcer.js';
import { slKitEnforcer } from './sl-kit-enforcer.js';
import { squadClaim } from './squad-claim.js';
import { squadJoinRequest } from './squad-join-request.js';
import { steamLevel } from './steam-level.js';
import { teamBalancer } from './team-balancer.js';
import { teamRandomizer } from './team-randomizer.js';
import { teamSwitch } from './team-switch.js';
import { welcomeWarn } from './welcome-warn.js';

/**
 * Kayıtlı plugin'ler.
 *
 * Plan Bölüm 6'daki ~20 çekirdek plugin buraya taşınıyor. Yeni plugin
 * eklemek = dosyayı yazıp bu listeye koymak; panelden açılana kadar hiçbir
 * şey yapmaz (`plugin_configs.enabled` varsayılanı false).
 */
export const PLUGINS: AnyPlugin[] = [
  broadcasts,
  autoKickUnassigned,
  welcomeWarn,
  nameEnforcer,
  slKitEnforcer,
  slBanEnforcer,
  autoTkWarn,
  playtimeSquadGuard,
  seedTracker,
  seedingMode,
  autoSeedScheduler,
  steamLevel,
  chatCommands,
  teamRandomizer,
  squadJoinRequest,
  fogOfWar,
  cblInfo,
  eliteCommander,
  squadClaim,
  adminCamWatchlist,
  teamBalancer,
  teamSwitch,
  adminRequest,
  myStats,
  roundScoreboard,
  adminCamVoice,
  rules,
  clanWarEnforcer,
];

export {
  broadcasts,
  autoKickUnassigned,
  welcomeWarn,
  nameEnforcer,
  slKitEnforcer,
  slBanEnforcer,
  autoTkWarn,
  playtimeSquadGuard,
  seedTracker,
  seedingMode,
  autoSeedScheduler,
  steamLevel,
  chatCommands,
  teamRandomizer,
  squadJoinRequest,
  fogOfWar,
  cblInfo,
  eliteCommander,
  squadClaim,
  adminCamWatchlist,
  teamBalancer,
  teamSwitch,
  adminRequest,
  myStats,
  roundScoreboard,
  adminCamVoice,
  rules,
  clanWarEnforcer,
};
