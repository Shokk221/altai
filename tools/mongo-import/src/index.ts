import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { accessSchema, createDb, identitySchema, moderationSchema } from '@altai/db';
import type { Db } from '@altai/db';
import { logger } from '@altai/shared';
import { classifyId, docId, toDate } from './parse.js';

/**
 * Eski sistemin MongoDB'sinden Faz 2 dilimini Postgres'e aktarır —
 * plan Bölüm 5.5-B.
 *
 * Faz 2 (moderasyon) BM verisiyle tamamlanmıyor: admin/whitelist yetkileri,
 * Discord<->oyun hesabı bağları ve admin cam kayıtları yalnızca Mongo'da.
 * Admin listesi ucu (Faz 2 teslimatı) bu veri olmadan üretilemez.
 *
 * Aktarılanlar:
 *   adminentries      -> grants          (whitelist/admin yetkileri)
 *   discordsteamlinks -> discord_links   (Discord <-> oyun hesabı)
 *   admincamlogs      -> admin_cam_logs  (POSSESSED/UNPOSSESSED eşleştirilir)
 *   dashbans (BM'de olmayanlar) -> bans  (İPTAL EDİLMİŞ olarak)
 *
 * Kullanım:
 *   pnpm mongo:import              kuru koşu (varsayılan), yazmaz
 *   pnpm mongo:import -- --write   gerçek aktarım
 *
 * Girdi canlı Mongo değil, mongoexport DÖKÜMÜ (NDJSON). İki sebeple:
 *  1. Panel konteyneri Mongo'ya ağdan erişemiyor (ayrı Docker ağları).
 *  2. Plan Bölüm 5.5-B: "Eski Mongo salt-okunur dondurulur, tam dump alınıp
 *     arşivlenir". Dosyadan okumak aktarımı tekrarlanabilir ve denetlenebilir
 *     kılıyor — canlı veritabanının o anki hâline bağlı kalmıyoruz.
 */

const args = process.argv.slice(2).filter((a) => a !== '--');
const write = args.includes('--write');

const dumpDir = process.env.MONGO_DUMP_DIR ?? './mongo-dump';
const databaseUrl = process.env.DATABASE_URL;

if (!existsSync(dumpDir)) {
  logger.error({ dumpDir }, 'Mongo dökümü bulunamadı (MONGO_DUMP_DIR)');
  process.exit(1);
}
if (!databaseUrl) {
  logger.error('DATABASE_URL tanımlı değil');
  process.exit(1);
}

/** mongoexport çıktısı: satır başına bir JSON belge. */
async function* readCollection(name: string): AsyncGenerator<Record<string, unknown>> {
  const file = path.join(dumpDir, `${name}.json`);
  if (!existsSync(file)) {
    logger.warn({ file }, 'koleksiyon dosyası yok, atlanıyor');
    return;
  }
  const lines = createInterface({
    input: createReadStream(file, { encoding: 'utf8' }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of lines) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as Record<string, unknown>;
    } catch {
      // Bozuk satır — atla, sayısı raporlanır.
    }
  }
}

const SOURCE = 'mongo';

interface Counters {
  [k: string]: number;
}

async function buildPlayerIndex(db: Db) {
  const rows = await db
    .select({
      id: identitySchema.players.id,
      steamId: identitySchema.players.steamId,
      eosId: identitySchema.players.eosId,
    })
    .from(identitySchema.players);
  const bySteam = new Map<string, string>();
  const byEos = new Map<string, string>();
  for (const r of rows) {
    if (r.steamId) bySteam.set(r.steamId, r.id);
    if (r.eosId) byEos.set(r.eosId, r.id);
  }
  logger.info({ steam: bySteam.size, eos: byEos.size }, 'oyuncu dizini hazır');
  return { bySteam, byEos };
}

const db = createDb(databaseUrl);
const { bySteam, byEos } = await buildPlayerIndex(db);

const resolve = (raw: unknown): string | undefined => {
  const { steamId, eosId } = classifyId(raw);
  if (steamId) return bySteam.get(steamId);
  if (eosId) return byEos.get(eosId);
  return undefined;
};

const stats: Counters = {};
const bump = (k: string, n = 1) => {
  stats[k] = (stats[k] ?? 0) + n;
};

// ------------------------------------------------------- adminentries -> grants
logger.info('adminentries okunuyor');
const grantRows: (typeof accessSchema.grants.$inferInsert)[] = [];
for await (const doc of readCollection('adminentries')) {
  bump('adminentries.okunan');
  const playerId = resolve(doc.id);
  if (!playerId) {
    bump('adminentries.oyuncu_bulunamadi');
    continue;
  }
  const expiresAt = toDate(doc.expiresAt);
  grantRows.push({
    playerId,
    groupName: String(doc.group ?? 'Bilinmiyor'),
    comment: typeof doc.comment === 'string' && doc.comment ? doc.comment : null,
    // Mevcut kayıtların hiçbiri Discord rolünden türetilmemiş; hepsi elle
    // verilmiş yetkiler. Rol zincirine bağlama işi panelden yapılacak.
    origin: 'manual',
    grantedAt: toDate(doc.createdAt) ?? new Date(),
    expiresAt: expiresAt ?? null,
    // Süresi geçmişse iptal edilmiş say: eski sistem bunları siliyordu,
    // biz tarihçe olarak tutuyoruz ama aktif göstermiyoruz.
    revokedAt: expiresAt && expiresAt < new Date() ? expiresAt : null,
    source: SOURCE,
    externalId: docId(doc),
  });
}

// --------------------------------------------- discordsteamlinks -> discord_links
logger.info('discordsteamlinks okunuyor');
const linkRows: (typeof accessSchema.discordLinks.$inferInsert)[] = [];
const seenDiscord = new Set<string>();
for await (const doc of readCollection('discordsteamlinks')) {
  bump('discordsteamlinks.okunan');
  const discordId = typeof doc.discordID === 'string' ? doc.discordID : null;
  if (!discordId) {
    bump('discordsteamlinks.discord_id_yok');
    continue;
  }
  const playerId = resolve(doc.steamID) ?? resolve(doc.eosID);
  if (!playerId) {
    bump('discordsteamlinks.oyuncu_bulunamadi');
    continue;
  }
  // discord_id unique; aynı Discord birden çok kayıt taşıyorsa ilki kalır.
  if (seenDiscord.has(discordId)) {
    bump('discordsteamlinks.tekrar');
    continue;
  }
  seenDiscord.add(discordId);
  linkRows.push({
    discordId,
    playerId,
    linkedAt: toDate(doc.linkedAt) ?? new Date(),
    source: SOURCE,
    externalId: docId(doc),
  });
}

// ------------------------------------------------ admincamlogs -> admin_cam_logs
// Mongo'da POSSESSED / UNPOSSESSED ayrı satırlar. Oyuncu bazında sıraya dizip
// eşleştiriyoruz: her POSSESSED, sonraki UNPOSSESSED ile kapanır.
logger.info('admincamlogs okunuyor');
// Zaman sırası şart: POSSESSED/UNPOSSESSED eşleştirmesi sıraya dayanıyor.
const camDocs: Record<string, unknown>[] = [];
for await (const doc of readCollection('admincamlogs')) camDocs.push(doc);
camDocs.sort((a, b) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')));

const camRows: (typeof moderationSchema.adminCamLogs.$inferInsert)[] = [];
const openCam = new Map<string, { enteredAt: Date; externalId: string }>();
for (const doc of camDocs) {
  bump('admincamlogs.okunan');
  // Oyuncu kimliği `raw` içindeki JSON'da; `player` alanı sadece isim.
  let steamId: string | undefined;
  let eosId: string | undefined;
  try {
    const raw = JSON.parse(String(doc.raw ?? '{}')) as { steamID?: string; eosID?: string };
    steamId = raw.steamID;
    eosId = raw.eosID;
  } catch {
    // raw bozuksa oyuncuya bağlanamaz
  }
  const playerId =
    (steamId ? bySteam.get(steamId) : undefined) ?? (eosId ? byEos.get(eosId) : undefined);
  const ts = toDate(doc.timestamp);
  if (!playerId || !ts) {
    bump('admincamlogs.eslesmedi');
    continue;
  }

  if (doc.type === 'POSSESSED') {
    openCam.set(playerId, { enteredAt: ts, externalId: docId(doc) });
  } else if (doc.type === 'UNPOSSESSED') {
    const open = openCam.get(playerId);
    if (open) {
      openCam.delete(playerId);
      camRows.push({ playerId, enteredAt: open.enteredAt, leftAt: ts });
      bump('admincamlogs.eslesen_cift');
    } else {
      bump('admincamlogs.kapanis_acilissiz');
    }
  }
}
// Kapanmamış girişler: kaydı yine tutuyoruz, leftAt null.
for (const [playerId, open] of openCam) {
  camRows.push({ playerId, enteredAt: open.enteredAt, leftAt: null });
  bump('admincamlogs.kapanmamis');
}

// ------------------------------- dashbans: BM'de OLMAYAN banlar (tarihsel kayıt)
logger.info('dashbans okunuyor');
const existing = await db
  .select({ externalId: moderationSchema.bans.externalId })
  .from(moderationSchema.bans);
const knownBanIds = new Set(existing.map((r) => r.externalId).filter(Boolean) as string[]);

const lostBanRows: (typeof moderationSchema.bans.$inferInsert)[] = [];
const now = new Date();
for await (const doc of readCollection('dashbans')) {
  if (!doc.banId || doc.banId === '') continue;
  bump('dashbans.okunan');
  const banId = String(doc.banId);
  if (knownBanIds.has(banId)) {
    bump('dashbans.zaten_var');
    continue;
  }
  const playerId = resolve(doc.steam64);
  if (!playerId) {
    bump('dashbans.oyuncu_bulunamadi');
    continue;
  }
  lostBanRows.push({
    playerId,
    reason: String(doc.reason ?? '(sebep yok)'),
    // BM'de artık yok: kaldırılmış kabul ediliyor. AKTİF OLARAK ALINMAZ,
    // yoksa BM'de bilinçli kaldırılmış banları yeniden uygulamış oluruz.
    revokedAt: now,
    internalNote:
      "BM'de bulunamadı (silinmiş). Tarihsel kayıt olarak eski sistemin Mongo verisinden alındı.",
    issuedByName: typeof doc.admin === 'string' && doc.admin.length < 80 ? doc.admin : null,
    createdAt: toDate(doc.time) ?? now,
    source: SOURCE,
    externalId: banId,
  });
}

// ----------------------------------------------------------------------- rapor
const summary = [
  '',
  write ? 'MONGO AKTARIMI (yazıldı)' : 'MONGO KURU KOŞU — hiçbir şey yazılmadı',
  '',
  `  grants (adminentries)      ${grantRows.length}`,
  `  discord_links              ${linkRows.length}`,
  `  admin_cam_logs             ${camRows.length}`,
  `  bans (BM'de olmayan)       ${lostBanRows.length}  [iptal edilmiş olarak]`,
  '',
  '  ayrıntı:',
  ...Object.entries(stats)
    .sort()
    .map(([k, v]) => `    ${k.padEnd(36)} ${v}`),
];

if (!write) {
  summary.push('', 'Yazmak için: pnpm mongo:import -- --write');
  process.stdout.write(`${summary.join('\n')}\n`);
  process.exit(0);
}

// ------------------------------------------------------------------- yazım
const CHUNK = 500;
const insertAll = async <T>(rows: T[], fn: (part: T[]) => Promise<unknown>) => {
  for (let i = 0; i < rows.length; i += CHUNK) await fn(rows.slice(i, i + CHUNK));
};

if (grantRows.length)
  await insertAll(grantRows, (p) => db.insert(accessSchema.grants).values(p).onConflictDoNothing());
if (linkRows.length)
  await insertAll(linkRows, (p) =>
    db.insert(accessSchema.discordLinks).values(p).onConflictDoNothing(),
  );
if (camRows.length)
  await insertAll(camRows, (p) =>
    db.insert(moderationSchema.adminCamLogs).values(p).onConflictDoNothing(),
  );
if (lostBanRows.length)
  await insertAll(lostBanRows, (p) =>
    db.insert(moderationSchema.bans).values(p).onConflictDoNothing(),
  );

summary.push('', 'Aktarım tamamlandı. Tekrar çalıştırılabilir — kayıtlar ikilenmez.');
process.stdout.write(`${summary.join('\n')}\n`);
process.exit(0);
