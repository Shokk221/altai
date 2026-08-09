import path from 'node:path';
import type { Db } from '@altai/db';
import { identitySchema, moderationSchema, presenceSchema } from '@altai/db';
import { logger } from '@altai/shared';
import { sql } from 'drizzle-orm';
import { type BmRecord, readNdjson, relId } from './ndjson.js';

/**
 * BM arşivi -> Postgres. Plan Bölüm 5.5-A/2.
 *
 * Tasarım kuralları:
 *
 * 1. TEKRAR ÇALIŞTIRILABİLİR. Her tabloda (source, external_id) tekil; import
 *    yarıda kalırsa aynı komut kaldığı yerden devam eder, kayıtları
 *    ikilemez. 400 bin satırlık bir işin ortasında kesilme ihtimali yüksek.
 *
 * 2. HİÇBİR ŞEY SİLİNMEZ. Kaldırılmış banlar/flagler revokedAt/removedAt ile
 *    işaretli olarak gelir — "bu oyuncuda ne zaman SL ban vardı" sorusu
 *    geçmişe dönük cevaplanabilmeli.
 *
 * 3. KAYNAK ETİKETLİ. Her satırda source='battlemetrics'. Geçiş sonrası bir
 *    tutarsızlık çıkarsa hangi verinin nereden geldiği bilinsin.
 */

const SOURCE = 'battlemetrics' as const;
const BATCH = 1_000;

export interface ImportOptions {
  db: Db;
  dir: string;
  /** BM sunucu id -> bizim slug. Örn: "27133078:squad-01,28022344:squad-02" */
  serverMap: Map<string, string>;
}

export interface ImportSummary {
  [table: string]: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** ISO string -> Date, geçersizse undefined (BM bazı alanları null bırakıyor). */
function date(value: unknown): Date | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms);
}

// ---------------------------------------------------------------- servers
export async function importServers(opts: ImportOptions): Promise<Map<string, string>> {
  const { db, dir, serverMap } = opts;
  const byBmId = new Map<string, string>();

  for await (const rec of readNdjson<BmRecord>(path.join(dir, 'servers.ndjson'))) {
    const slug = serverMap.get(rec.id);
    if (!slug) {
      logger.warn({ bmServerId: rec.id }, 'BM_SERVER_MAP içinde yok — bu sunucu atlanıyor');
      continue;
    }
    const name = String(rec.attributes?.name ?? slug);

    // Agent da aynı slug ile satır oluşturuyor. Çakışırsa BM id'sini ve ismi
    // güncelliyoruz; iki taraf tek satırda buluşsun.
    const [row] = await db
      .insert(presenceSchema.servers)
      .values({ slug, name, battlemetricsId: rec.id })
      .onConflictDoUpdate({
        target: presenceSchema.servers.slug,
        set: { battlemetricsId: rec.id },
      })
      .returning();

    if (row) byBmId.set(rec.id, row.id);
  }

  logger.info({ sunucu: byBmId.size }, 'sunucular eşlendi');
  return byBmId;
}

// ---------------------------------------------------------------- players
interface PlayerDraft {
  bmId: string;
  steamId?: string | undefined;
  eosId?: string | undefined;
}

export async function importPlayers(opts: ImportOptions): Promise<Map<string, string>> {
  const { db, dir } = opts;

  // 1) Kimlikleri topla. players.included.ndjson 600 MB — akışla okunuyor.
  const steamByBm = new Map<string, string>();
  const eosByBm = new Map<string, string>();
  interface NameDraft {
    bmPlayerId: string;
    name: string;
    lastSeen?: Date | undefined;
    externalId: string;
  }
  const names: NameDraft[] = [];

  for await (const rec of readNdjson<BmRecord>(path.join(dir, 'players.included.ndjson'))) {
    if (rec.type !== 'identifier') continue;
    const bmPlayerId = relId(rec, 'player');
    if (!bmPlayerId) continue;
    const kind = rec.attributes?.type;
    const value = rec.attributes?.identifier;
    if (typeof value !== 'string' || !value) continue;

    if (kind === 'steamID') steamByBm.set(bmPlayerId, value);
    else if (kind === 'eosID') eosByBm.set(bmPlayerId, value);
    else if (kind === 'name') {
      names.push({
        bmPlayerId,
        name: value,
        lastSeen: date(rec.attributes?.lastSeen),
        externalId: rec.id,
      });
    }
  }

  // 2) Oyuncuları hazırla. SteamID'si olmayan İÇERİ ALINMAZ: players tablosu
  //    steam_id üzerine kurulu ve kimliksiz bir oyuncu agent'ın toplayacağı
  //    canlı veriyle hiçbir zaman eşleşemez (çözümleme raporuna bakın).
  // En az bir kimlik yeterli. Squad oyuncuyu EOS ile tanıdığı için
  // SteamID'siz ama EOS'lu oyuncular da içeri alınır; ikisi de yoksa oyuncu
  // hiçbir canlı kayıtla eşleşemez, atlanır.
  const drafts: PlayerDraft[] = [];
  let skippedNoIdentity = 0;
  let eosOnly = 0;
  for await (const rec of readNdjson<BmRecord>(path.join(dir, 'players.ndjson'))) {
    const steamId = steamByBm.get(rec.id);
    const eosId = eosByBm.get(rec.id);
    if (!steamId && !eosId) {
      skippedNoIdentity++;
      continue;
    }
    if (!steamId) eosOnly++;
    drafts.push({ bmId: rec.id, steamId, eosId });
  }

  logger.info(
    { alinacak: drafts.length, sadeceEos: eosOnly, kimliksiz: skippedNoIdentity },
    'oyuncular yazılıyor',
  );

  // 3) Yaz. steam_id çakışırsa BM id'sini ve EOS'u tamamla — agent önce
  //    oluşturmuş olabilir.
  // İki ayrı upsert: çakışma hedefi steam_id olanlar ve olmayanlar. Tek
  // sorguda yapılamaz, ON CONFLICT tek bir hedef kolon alır.
  let written = 0;
  const withSteam = drafts.filter((d) => d.steamId);
  const withoutSteam = drafts.filter((d) => !d.steamId);

  for (const part of chunk(withSteam, BATCH)) {
    await db
      .insert(identitySchema.players)
      .values(
        part.map((d) => ({
          steamId: d.steamId ?? null,
          eosId: d.eosId ?? null,
          battlemetricsId: d.bmId,
        })),
      )
      .onConflictDoUpdate({
        target: identitySchema.players.steamId,
        set: {
          battlemetricsId: sql`excluded.battlemetrics_id`,
          // Mevcut EOS varsa dokunma; yoksa arşivdekini yaz.
          eosId: sql`coalesce(${identitySchema.players.eosId}, excluded.eos_id)`,
        },
      });
    written += part.length;
    if (written % 20_000 === 0) logger.info({ written }, 'oyuncu ilerleme');
  }

  for (const part of chunk(withoutSteam, BATCH)) {
    await db
      .insert(identitySchema.players)
      .values(part.map((d) => ({ steamId: null, eosId: d.eosId ?? null, battlemetricsId: d.bmId })))
      .onConflictDoUpdate({
        target: identitySchema.players.eosId,
        set: { battlemetricsId: sql`excluded.battlemetrics_id` },
      });
    written += part.length;
  }

  // 4) BM id -> uuid haritası (session/ban/flag bağlamak için)
  const rows = await db
    .select({ id: identitySchema.players.id, bmId: identitySchema.players.battlemetricsId })
    .from(identitySchema.players);
  const byBmId = new Map<string, string>();
  for (const r of rows) if (r.bmId) byBmId.set(r.bmId, r.id);

  // 5) İsim geçmişi — 930 bin kayıt, arşivin en değerli parçalarından.
  const nameRows = names
    .map((n) => {
      const playerId = byBmId.get(n.bmPlayerId);
      if (!playerId) return null;
      return {
        playerId,
        name: n.name,
        lastSeen: n.lastSeen ?? null,
        source: SOURCE,
        externalId: n.externalId,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  let nameWritten = 0;
  for (const part of chunk(nameRows, BATCH)) {
    await db.insert(identitySchema.playerNames).values(part).onConflictDoNothing();
    nameWritten += part.length;
    if (nameWritten % 100_000 === 0) logger.info({ nameWritten }, 'isim geçmişi ilerleme');
  }

  logger.info({ oyuncu: byBmId.size, isim: nameWritten }, 'oyuncular tamam');
  return byBmId;
}

// --------------------------------------------------------------- sessions
export async function importSessions(
  opts: ImportOptions,
  servers: Map<string, string>,
  players: Map<string, string>,
): Promise<number> {
  const { db, dir } = opts;

  let batch: (typeof presenceSchema.gameSessions.$inferInsert)[] = [];
  let written = 0;
  let skipped = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    await db.insert(presenceSchema.gameSessions).values(batch).onConflictDoNothing();
    written += batch.length;
    batch = [];
    if (written % 50_000 === 0) logger.info({ written }, 'session ilerleme');
  };

  for await (const rec of readNdjson<BmRecord>(path.join(dir, 'sessions.ndjson'))) {
    const serverId = servers.get(relId(rec, 'server') ?? '');
    const playerId = players.get(relId(rec, 'player') ?? '');
    const joinedAt = date(rec.attributes?.start);
    if (!serverId || !playerId || !joinedAt) {
      skipped++;
      continue;
    }

    batch.push({
      serverId,
      playerId,
      joinedAt,
      leftAt: date(rec.attributes?.stop) ?? null,
      source: SOURCE,
      externalId: rec.id,
    });
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  logger.info({ session: written, atlanan: skipped }, 'sessionlar tamam');
  return written;
}

// ------------------------------------------------------------------ flags
export async function importFlags(opts: ImportOptions): Promise<Map<string, string>> {
  const { db, dir } = opts;
  const byBmId = new Map<string, string>();

  for await (const rec of readNdjson<BmRecord>(path.join(dir, 'player-flags.ndjson'))) {
    const [row] = await db
      .insert(moderationSchema.flags)
      .values({
        name: String(rec.attributes?.name ?? rec.id),
        description: (rec.attributes?.description as string | undefined) ?? null,
        color: (rec.attributes?.color as string | undefined) ?? null,
        icon: (rec.attributes?.icon as string | undefined) ?? null,
        source: SOURCE,
        externalId: rec.id,
      })
      .onConflictDoUpdate({
        target: [moderationSchema.flags.source, moderationSchema.flags.externalId],
        set: { name: String(rec.attributes?.name ?? rec.id) },
      })
      .returning();
    if (row) byBmId.set(rec.id, row.id);
  }

  logger.info({ flag: byBmId.size }, 'flag tanımları tamam');
  return byBmId;
}

export async function importFlagAssignments(
  opts: ImportOptions,
  flags: Map<string, string>,
  players: Map<string, string>,
): Promise<number> {
  const { db, dir } = opts;
  let batch: (typeof moderationSchema.flagAssignments.$inferInsert)[] = [];
  let written = 0;
  let skipped = 0;
  // Arşivde aynı atama birden çok kez bulunabiliyor (BM, bir flag'e göre
  // filtrelenmiş listede oyuncunun diğer flaglerini de döndürüyor).
  const seen = new Set<string>();

  const flush = async () => {
    if (batch.length === 0) return;
    await db.insert(moderationSchema.flagAssignments).values(batch).onConflictDoNothing();
    written += batch.length;
    batch = [];
  };

  for await (const rec of readNdjson<BmRecord>(path.join(dir, 'player-flag-assignments.ndjson'))) {
    if (seen.has(rec.id)) continue;
    seen.add(rec.id);

    const flagId = flags.get(relId(rec, 'playerFlag') ?? '');
    const playerId = players.get(relId(rec, 'player') ?? '');
    if (!flagId || !playerId) {
      skipped++;
      continue;
    }

    batch.push({
      flagId,
      playerId,
      addedAt: date(rec.attributes?.addedAt) ?? new Date(),
      removedAt: date(rec.attributes?.removedAt) ?? null,
      source: SOURCE,
      externalId: rec.id,
    });
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  logger.info({ atama: written, atlanan: skipped }, 'flag atamaları tamam');
  return written;
}

// ------------------------------------------------------------------- bans
export async function importBans(
  opts: ImportOptions,
  servers: Map<string, string>,
  players: Map<string, string>,
): Promise<number> {
  const { db, dir } = opts;

  // Banların %79'u, sunucularımızda hiç oynamamış oyunculara ait (paylaşımlı
  // hile listeleri). Bu oyuncular players.ndjson'da YOK — ama ban kaydının
  // kendisi SteamID/EOS taşıyor, o yüzden buradan oluşturulabiliyorlar.
  interface BanDraft {
    rec: BmRecord;
    steamId?: string | undefined;
    eosId?: string | undefined;
  }
  const drafts: BanDraft[] = [];
  let noIdentity = 0;

  for await (const rec of readNdjson<BmRecord>(path.join(dir, 'bans.ndjson'))) {
    const ids = (rec.attributes?.identifiers ?? []) as Array<{
      type?: string;
      identifier?: string;
    }>;
    const steamId = ids.find((i) => i.type === 'steamID')?.identifier;
    const eosId = ids.find((i) => i.type === 'eosID')?.identifier;
    if (!steamId && !eosId) {
      // Hiçbir kimliği olmayan ban ne bir oyuncuya bağlanabilir ne de oyun
      // içi listeye yazılabilir. Sayısı raporlanır.
      noIdentity++;
      continue;
    }
    // SteamID'si olmayan ama EOS'u olan banlar İÇERİ ALINIR: ban listemiz
    // EOS satırı da ürettiği için bunlar oyunda uygulanabiliyor.
    drafts.push({ rec, steamId, eosId });
  }

  // Eksik oyuncuları oluştur.
  const missing = drafts.filter((d) => {
    const bmPlayerId = relId(d.rec, 'player');
    return !bmPlayerId || !players.has(bmPlayerId);
  });
  if (missing.length > 0) {
    logger.info({ eksik: missing.length }, 'ban kayıtlarından eksik oyuncular oluşturuluyor');
    for (const part of chunk(missing, BATCH)) {
      await db
        .insert(identitySchema.players)
        .values(
          part.map((d) => ({
            steamId: d.steamId ?? null,
            eosId: d.eosId ?? null,
            battlemetricsId: relId(d.rec, 'player') ?? null,
          })),
        )
        .onConflictDoNothing();
    }
  }

  // Kimlik -> uuid. Bir ban SteamID veya EOS ile bağlanabilir.
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

  let batch: (typeof moderationSchema.bans.$inferInsert)[] = [];
  let written = 0;
  let skipped = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    await db.insert(moderationSchema.bans).values(batch).onConflictDoNothing();
    written += batch.length;
    batch = [];
  };

  for (const d of drafts) {
    const playerId =
      (d.steamId ? bySteam.get(d.steamId) : undefined) ??
      (d.eosId ? byEos.get(d.eosId) : undefined);
    if (!playerId) {
      skipped++;
      continue;
    }

    const a = d.rec.attributes ?? {};
    batch.push({
      playerId,
      // orgWide ban tüm sunucular için: serverId null bırakılıyor.
      serverId: a.orgWide === true ? null : (servers.get(relId(d.rec, 'server') ?? '') ?? null),
      reason: String(a.reason ?? '(sebep yok)'),
      internalNote: typeof a.note === 'string' && a.note.trim() ? a.note : null,
      // BM'de süresiz ban expires=null; kolonumuz da null = kalıcı.
      expiresAt: date(a.expires) ?? null,
      createdAt: date(a.timestamp) ?? new Date(),
      issuedByName: (d.rec.meta?.player as string | undefined) ? null : null,
      banListName: relId(d.rec, 'banList') ?? null,
      source: SOURCE,
      externalId: d.rec.id,
    });
    if (batch.length >= BATCH) await flush();
  }
  await flush();

  logger.info({ ban: written, kimliksiz: noIdentity, atlanan: skipped }, 'banlar tamam');
  return written;
}

// ------------------------------------------------------------------- akış
export async function runImport(opts: ImportOptions): Promise<ImportSummary> {
  const servers = await importServers(opts);
  if (servers.size === 0) {
    throw new Error('Hiç sunucu eşlenmedi — BM_SERVER_MAP doğru mu?');
  }

  const players = await importPlayers(opts);
  const sessions = await importSessions(opts, servers, players);
  const flags = await importFlags(opts);
  const assignments = await importFlagAssignments(opts, flags, players);
  const bans = await importBans(opts, servers, players);

  return {
    servers: servers.size,
    players: players.size,
    sessions,
    flags: flags.size,
    flag_assignments: assignments,
    bans,
  };
}

/** Import sonrası gerçek tablo sayıları — rapor bunları arşivle karşılaştırır. */
export async function countTables(db: Db): Promise<ImportSummary> {
  const one = async (table: string) => {
    const res = await db.execute<{ n: string }>(
      sql.raw(`select count(*)::text as n from "${table}"`),
    );
    const rows = res as unknown as Array<{ n: string }>;
    return Number(rows[0]?.n ?? 0);
  };
  return {
    servers: await one('servers'),
    players: await one('players'),
    player_names: await one('player_names'),
    game_sessions: await one('game_sessions'),
    flags: await one('flags'),
    flag_assignments: await one('flag_assignments'),
    bans: await one('bans'),
  };
}
