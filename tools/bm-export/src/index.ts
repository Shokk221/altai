import { logger } from '@altai/shared';
import { exportBmResource } from './resource-writer.js';

// Bölüm 5.5-A: BattleMetrics'ten ham arşiv çekimi. BM aboneliği arşivlenmeden
// iptal edilmeyecek — bu araç o arşivi çıkarır.
//
// Doğrulanmış (BM API dokümantasyonuyla eşleşen) uçlar: players, bans.
// notes/flags/reserved-slot/server-history uçları org yapına göre değişebilir
// (organization-scoped resource'lar) — BM_ORGANIZATION_ID ile birlikte BM'nin
// kendi API dokümantasyonundan (battlemetrics.com/developers/documentation)
// doğrulanıp aynı exportBmResource() deseniyle eklenmesi yeterli.

const token = process.env.BATTLEMETRICS_TOKEN;
const organizationId = process.env.BM_ORGANIZATION_ID;
const outDir = process.env.BM_EXPORT_DIR ?? './bm-archive';

if (!token) {
  logger.error('BATTLEMETRICS_TOKEN tanımlı değil');
  process.exit(1);
}
if (!organizationId) {
  logger.error('BM_ORGANIZATION_ID tanımlı değil (bans filtrelemesi için gerekli)');
  process.exit(1);
}

logger.info({ outDir }, 'BM arşivleme başladı');

// Oyuncular + identifier'lar (SteamID/EOS eşlemeleri, isim geçmişi dahil —
// include=identifier ile aynı sayfada gelir, ayrı istek gerekmez)
await exportBmResource({
  resourceName: 'players',
  bmPath: '/players',
  token,
  outDir,
  baseParams: { include: 'identifier' },
});

// Banlar — kritik alan: bmBanlistID, sebep, süre, kanıt, banı atan admin.
// Mevcut ban sync'inin kullandığı 5000 kayıt limiti burada YOK — tam sayfalamalı.
await exportBmResource({
  resourceName: 'bans',
  bmPath: '/bans',
  token,
  outDir,
  baseParams: { 'filter[organization]': organizationId, include: 'user,server' },
});

logger.info(
  { outDir },
  'BM arşivleme tamamlandı — ham JSON dosyaları hazır, ETL (Faz 2) bu dosyaları okuyacak',
);
