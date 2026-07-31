import { logger } from '@altai/shared';

// Bölüm 5.5-A: BattleMetrics'ten ham arşiv çekimi (players, sessions, bans,
// notes, flags, reserved slots, server history). Sayfalama + rate-limit'e
// uyar, sonucu raw_events'e / diske JSON olarak yazar. BM aboneliği
// arşivlenmeden iptal edilmeyecek — bu araç Faz 1'de asıl işi yapacak.
logger.info('bm-export iskeleti hazır — BM API çekim mantığı Faz 1de eklenecek');
