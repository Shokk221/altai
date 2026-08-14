import type { AnyPlugin } from '@altai/squad';
import { autoKickUnassigned } from './auto-kick-unassigned.js';
import { autoSeedScheduler } from './auto-seed-scheduler.js';
import { autoTkWarn } from './auto-tk-warn.js';
import { broadcasts } from './broadcasts.js';
import { nameEnforcer } from './name-enforcer.js';
import { playtimeSquadGuard } from './playtime-squad-guard.js';
import { seedTracker } from './seed-tracker.js';
import { seedingMode } from './seeding-mode.js';
import { slBanEnforcer } from './sl-ban-enforcer.js';
import { slKitEnforcer } from './sl-kit-enforcer.js';
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
};
