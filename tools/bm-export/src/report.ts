import { statSync } from 'node:fs';
import type { Archive, ResourceStatus } from './archive.js';
import {
  FLAG_ASSIGNMENT_RESOURCE,
  LIST_RESOURCES,
  PER_PLAYER_RESOURCES,
  SERVER_HISTORY_RESOURCES,
  SERVER_LIST_RESOURCES,
} from './resources.js';

/** Kaynak adı -> kritik mi. "outages@12345" gibi sunucu ekli adlar da çözülür. */
const CRITICAL = new Map<string, boolean>([
  ['servers', true],
  [FLAG_ASSIGNMENT_RESOURCE.name, FLAG_ASSIGNMENT_RESOURCE.critical],
  ...LIST_RESOURCES.map((r) => [r.name, r.critical] as const),
  ...PER_PLAYER_RESOURCES.map((r) => [r.name, r.critical] as const),
  ...SERVER_HISTORY_RESOURCES.map((r) => [r.name, r.critical] as const),
  ...SERVER_LIST_RESOURCES.map((r) => [r.name, r.critical] as const),
]);

function isCritical(resourceName: string): boolean {
  const base = resourceName.split('@')[0] ?? resourceName;
  return CRITICAL.get(base) ?? false;
}

/**
 * Arşiv raporu — plan Bölüm 5.5-A adım 3'ün ("import sonrası sayılar BM
 * panelindeki sayılarla karşılaştırılır") ilk yarısı. Buradaki sayılar BM
 * panelindeki toplamlarla elle karşılaştırılır; ETL sonrası aynı sayılar
 * Postgres'ten tekrar üretilip üç taraf da tutuyor mu diye bakılır.
 */

const STATUS_LABEL: Record<ResourceStatus, string> = {
  pending: '· başlamadı',
  running: '~ yarım',
  done: '✓ tamam',
  failed: '✗ hata',
  unsupported: '- desteklenmiyor',
  skipped: '⊘ atlandı (karar)',
};

function fileSize(filePath: string): string {
  try {
    const bytes = statSync(filePath).size;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  } catch {
    return '-';
  }
}

export function formatReport(archive: Archive): string {
  const state = archive.state;
  const names = Object.keys(state.resources).sort();

  const rows = names.map((name) => {
    const resource = state.resources[name];
    return {
      kaynak: name,
      kritik: isCritical(name) ? 'EVET' : '',
      durum: resource ? STATUS_LABEL[resource.status] : '?',
      kayit: resource ? resource.records.toLocaleString('tr-TR') : '0',
      boyut: fileSize(archive.dataPath(name)),
      hata: (resource?.error ?? '').split('\n')[0]?.slice(0, 50) ?? '',
    };
  });

  const headers = ['kaynak', 'kritik', 'durum', 'kayit', 'boyut', 'hata'] as const;
  const widths = headers.map((h) => Math.max(h.length, ...rows.map((r) => r[h].length)));
  const line = (cells: readonly string[]) =>
    cells.map((cell, i) => cell.padEnd(widths[i] ?? cell.length)).join('  ');

  const out = [
    `BattleMetrics arşivi — org ${state.organizationId}`,
    `dizin: ${archive.dir}`,
    `sunucular: ${state.serverIds.join(', ') || '(yok)'}`,
    `son güncelleme: ${state.updatedAt}`,
    '',
    line(headers),
    line(widths.map((w) => '-'.repeat(w))),
    ...rows.map((row) => line(headers.map((h) => row[h]))),
    '',
  ];

  const withStatus = (...wanted: ResourceStatus[]) =>
    names.filter((name) => {
      const status = state.resources[name]?.status;
      return status !== undefined && wanted.includes(status);
    });

  // Tekrar denemenin işe yarayacağı durumlar ile yaramayacağı durumlar ayrı:
  // "unsupported" (401/403/404) bir daha çalıştırınca düzelmez, token/plan işi.
  const retryable = withStatus('pending', 'running', 'failed');
  const unsupported = withStatus('unsupported');
  // Bilinçli atlananlar "eksik" sayılmaz — ama iptal kararı verilirken
  // gözden kaçmasınlar diye ayrıca ve açıkça listelenirler.
  const skipped = withStatus('skipped');

  // Manifest'te hiç görünmeyen kritik kaynaklar. Bu kontrol olmadan boş bir
  // arşiv "kritik kaynakların hepsi tamam" derdi — aboneliği iptal ettirecek
  // türden bir yanlış pozitif.
  const missing = [...CRITICAL.entries()]
    .filter(([name, critical]) => critical && state.resources[name] === undefined)
    .map(([name]) => name);

  const blockedCritical = [...retryable, ...unsupported].filter(isCritical).concat(missing);

  if (retryable.length > 0) {
    out.push(`Yarım kalan kaynaklar: ${retryable.join(', ')}`);
    out.push(
      'Aynı komutu tekrar çalıştırın — tamamlananlar atlanır, yarım kalanlar kaldığı yerden devam eder.',
    );
    out.push('');
  }

  if (unsupported.length > 0) {
    out.push(`Erişilemeyen uçlar (401/403/404): ${unsupported.join(', ')}`);
    out.push(
      'Bunlar tekrar denemeyle düzelmez. Token org sahibi bir hesaba mı ait, BM planınız bu özelliği kapsıyor mu?',
    );
    out.push('');
  }

  if (missing.length > 0) {
    out.push(`Hiç çekilmemiş kritik kaynaklar: ${missing.join(', ')}`);
    out.push('');
  }

  if (skipped.length > 0) {
    out.push(`BİLİNÇLİ OLARAK ARŞİVLENMEDİ: ${skipped.join(', ')}`);
    out.push('Bu bir karardı, hata değil. Ama abonelik iptal edilince bu veri');
    out.push('geri getirilemez — fikir değiştiyseniz `--only <kaynak>` ile şimdi çekin.');
    out.push('');
  }

  if (blockedCritical.length === 0) {
    out.push('✓ Kritik kaynakların hepsi tamam.');
    out.push('SONRAKİ ADIM: bu sayıları BM panelindeki toplamlarla karşılaştırın (plan 5.5-A/3).');
    out.push('Sayılar tutuyorsa BM aboneliği iptal edilebilir.');
  } else {
    out.push(`✗ EKSİK KRİTİK KAYNAKLAR: ${blockedCritical.join(', ')}`);
    out.push('BM ABONELİĞİNİ İPTAL ETMEYİN — bu veriler geri getirilemez (plan Bölüm 5.5-A).');
  }

  return out.join('\n');
}
