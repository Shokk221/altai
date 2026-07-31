import { logger } from '@altai/shared';

// Faz 1'de dolacak: her ServerInstance için SquadJS başlatma,
// SquadJSAdapter -> TypedEventBus -> PersistenceWriter/Uplink kablolaması.
// Faz 0'da agent sadece ayakta kalıyor ve heartbeat atıyor — milestone
// bunu değil, Discord OAuth akışını doğruluyor.
logger.info('agent başladı (Faz 1 beklemede: SquadJS entegrasyonu henüz yok)');
