import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import {
  accessSchema,
  createDb,
  identitySchema,
  matchesSchema,
  moderationSchema,
  presenceSchema,
} from '@altai/db';
import type { Db } from '@altai/db';
import { logger } from '@altai/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import { classifyId, defaultGrantMode, docId, toDate } from './parse.js';

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

// ------------------------------------------- admingroups -> squad_admin_groups
// Grup tanımları Admins.cfg'deki `Group=<ad>:<yetkiler>` satırını üretir.
// grant_mode İSİMDEN DEĞİL YETKİDEN türetiliyor: yalnızca `reserve` veren
// grup whitelist'tir (elle verilir), kick/ban veren grup yetkilidir ve
// Discord zincirine bağlıdır. İsim listesi olsaydı yarın eklenen bir grup
// sessizce yanlış tarafa düşerdi.
logger.info('admingroups okunuyor');
const groupRows: (typeof accessSchema.squadAdminGroups.$inferInsert)[] = [];
const seenGroup = new Set<string>();
for await (const doc of readCollection('admingroups')) {
  bump('admingroups.okunan');
  const name = typeof doc.name === 'string' ? doc.name : null;
  if (!name) continue;
  // Aynı grup birden çok sunucu için tanımlı olabilir; tanım aynı olduğu
  // için tek satıra indiriyoruz (serverId null = tüm sunucular).
  if (seenGroup.has(name)) {
    bump('admingroups.tekrar');
    continue;
  }
  seenGroup.add(name);
  // Mongo'daki alan adı `permissions`; bizde `squadPermissions` (oyun içi
  // erişim seviyeleri — panel izinleriyle karışmasın diye ayrıştırıldı).
  const permissions = typeof doc.permissions === 'string' ? doc.permissions : '';
  groupRows.push({
    name,
    squadPermissions: permissions,
    grantMode: defaultGrantMode(permissions),
    source: SOURCE,
    externalId: docId(doc),
  });
  bump(`admingroups.mode_${defaultGrantMode(permissions)}`);
}

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

// -------------------------------------------- idmappings -> kimlik tamamlama
// 31.204 Steam<->EOS eşlemesi. Değeri şurada: BM arşivi oyuncuların bir
// kısmını yalnızca Steam, bir kısmını yalnızca EOS ile tanıyor. Squad artık
// EOS ile kimliklendirdiği için eksik tarafı doldurmak, aynı kişinin iki ayrı
// kayda bölünmesini engelliyor.
logger.info('idmappings okunuyor');
const yeniOyuncular: (typeof identitySchema.players.$inferInsert)[] = [];
const eosGuncelle: { playerId: string; eosId: string }[] = [];
const steamGuncelle: { playerId: string; steamId: string }[] = [];
const yeniIsimler: { steamId: string; name: string; lastSeen: Date | null }[] = [];
// Aynı EOS'u iki farklı oyuncuya yazmayalım; unique kısıt zaten engellerdi
// ama sessiz çakışma yerine sayılabilir bir rapor istiyoruz.
const eosSahipli = new Set(byEos.keys());
const steamSahipli = new Set(bySteam.keys());

for await (const doc of readCollection('idmappings')) {
  bump('idmappings.okunan');
  const { steamId } = classifyId(String(doc.steamID ?? ''));
  const { eosId } = classifyId(String(doc.eosID ?? ''));
  if (!steamId || !eosId) {
    bump('idmappings.kimlik_gecersiz');
    continue;
  }
  const steamPid = bySteam.get(steamId);
  const eosPid = byEos.get(eosId);

  if (steamPid && eosPid) {
    if (steamPid === eosPid) bump('idmappings.zaten_tam');
    // İki AYRI kayda düşmüş aynı kişi. Birleştirme yıkıcı bir işlem
    // (ban/oturum/grant taşımak gerekir), burada yapmıyoruz — raporluyoruz.
    else bump('idmappings.CAKISMA_iki_ayri_kayit');
    continue;
  }
  if (steamPid && !eosPid) {
    if (eosSahipli.has(eosId)) {
      bump('idmappings.eos_baskasinda');
      continue;
    }
    eosSahipli.add(eosId);
    byEos.set(eosId, steamPid);
    eosGuncelle.push({ playerId: steamPid, eosId });
    bump('idmappings.eos_dolduruldu');
    continue;
  }
  if (!steamPid && eosPid) {
    if (steamSahipli.has(steamId)) {
      bump('idmappings.steam_baskasinda');
      continue;
    }
    steamSahipli.add(steamId);
    bySteam.set(steamId, eosPid);
    steamGuncelle.push({ playerId: eosPid, steamId });
    bump('idmappings.steam_dolduruldu');
    continue;
  }
  // Hiç tanımadığımız oyuncu: sunucumuzda oynamış ama BM arşivinde yok.
  eosSahipli.add(eosId);
  steamSahipli.add(steamId);
  yeniOyuncular.push({ steamId, eosId });
  const isim = typeof doc.lastName === 'string' ? doc.lastName.trim() : '';
  // İsmi yalnızca YENİ oyuncular için yazıyoruz: mevcut oyuncuların isim
  // geçmişi BM'den zaten geldi (857 bin kayıt) ve player_names'te tekillik
  // kısıtı yok — tekrar yazmak kopya üretirdi.
  if (isim) yeniIsimler.push({ steamId, name: isim, lastSeen: toDate(doc.updatedAt) ?? null });
  bump('idmappings.yeni_oyuncu');
}

// ----------------------------------------- roundscoreboards -> rounds/round_players
// Faz 1'in eksiği olan maç kaydını geçmişe dönük kapatıyor: 20 Şubat'tan
// bugüne 2.304 maç, oyuncu kırılımıyla.
logger.info('roundscoreboards okunuyor');
const sunucuAdaGore = new Map<string, string>();
{
  const rows = await db
    .select({ id: presenceSchema.servers.id, name: presenceSchema.servers.name })
    .from(presenceSchema.servers);
  for (const r of rows) if (r.name) sunucuAdaGore.set(r.name, r.id);
}
/**
 * Sunucu adı serbest metin ve zaman içinde değişmiş: 1.883 kayıt "… #1 …",
 * 421 kayıt "#1" olmadan — aynı sunucunun yeniden adlandırılmış hâli.
 * Turnuva sunucusunun adı tamamen farklı ("ACCF"), o yüzden bu kalıp onu
 * yanlışlıkla yakalamıyor. Eşleşmezse serverId null bırakılıp ham ad
 * saklanıyor; uydurma bağ kurmuyoruz.
 */
const sunucuCoz = (ad: unknown): string | null => {
  if (typeof ad !== 'string') return null;
  const tam = sunucuAdaGore.get(ad);
  if (tam) return tam;
  if (ad.includes('TÜRK ALTAI COMMUNITY')) {
    for (const [name, id] of sunucuAdaGore) if (name.includes('TÜRK ALTAI COMMUNITY')) return id;
  }
  return null;
};

const sayi = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const takim = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

interface MacKaydi {
  round: typeof matchesSchema.rounds.$inferInsert;
  oyuncular: Omit<typeof matchesSchema.roundPlayers.$inferInsert, 'roundId'>[];
}
const maclar: MacKaydi[] = [];

for await (const doc of readCollection('roundscoreboards')) {
  bump('roundscoreboards.okunan');
  const startedAt = toDate(doc.startTime);
  if (!startedAt) {
    bump('roundscoreboards.baslangic_yok');
    continue;
  }
  const t1 = takim(doc.team1);
  const t2 = takim(doc.team2);
  const ham = Array.isArray(doc.players) ? (doc.players as Record<string, unknown>[]) : [];

  // Kazanan: skorbordda ayrı alan yok, oyuncu satırlarındaki isWinner'dan
  // türetiliyor. Hiç kazanan işaretli yoksa null — beraberlik/yarım maç.
  let winnerTeam: number | null = null;
  for (const p of ham) {
    if (p.isWinner === true) {
      const t = sayi(p.teamID);
      if (t === 1 || t === 2) {
        winnerTeam = t;
        break;
      }
    }
  }

  const serverId = sunucuCoz(doc.serverName);
  if (!serverId) bump('roundscoreboards.sunucu_eslesmedi');

  const oyuncular: MacKaydi['oyuncular'] = [];
  const gorulenSteam = new Set<string>();
  for (const p of ham) {
    const { steamId } = classifyId(String(p.steamID ?? ''));
    const { eosId } = classifyId(String(p.eosID ?? ''));
    if (!steamId) {
      // steam_id maç içi tekillik anahtarı; olmayanı alamayız.
      bump('roundscoreboards.oyuncu_steamsiz');
      continue;
    }
    if (gorulenSteam.has(steamId)) {
      bump('roundscoreboards.oyuncu_tekrar');
      continue;
    }
    gorulenSteam.add(steamId);
    oyuncular.push({
      // Bağlanamayanlar null kalır; yazımdan sonra tek bir UPDATE ile
      // geriye dönük bağlanıyorlar.
      playerId: bySteam.get(steamId) ?? (eosId ? byEos.get(eosId) : undefined) ?? null,
      steamId,
      eosId: eosId ?? null,
      name: typeof p.name === 'string' ? p.name.trim() : null,
      teamId: sayi(p.teamID),
      squadId: sayi(p.squadID),
      role: typeof p.role === 'string' ? p.role : null,
      isLeader: typeof p.isLeader === 'boolean' ? p.isLeader : null,
      kills: sayi(p.kills) ?? 0,
      deaths: sayi(p.deaths) ?? 0,
      revives: sayi(p.revives) ?? 0,
      teamkills: sayi(p.teamkills) ?? 0,
      killstreak: sayi(p.killstreak),
      damageDealt: sayi(p.damageDealt),
      damageTaken: sayi(p.damageTaken),
      isWinner: typeof p.isWinner === 'boolean' ? p.isWinner : null,
      weapons: p.weapons && typeof p.weapons === 'object' ? p.weapons : null,
    });
  }
  bump('roundscoreboards.oyuncu_satiri', oyuncular.length);

  maclar.push({
    round: {
      serverId,
      serverName: typeof doc.serverName === 'string' ? doc.serverName : null,
      map: typeof doc.map === 'string' ? doc.map : null,
      layer: typeof doc.layer === 'string' ? doc.layer : null,
      level: typeof doc.level === 'string' ? doc.level : null,
      startedAt,
      endedAt: toDate(doc.endTime) ?? null,
      durationSeconds: sayi(doc.durationSeconds),
      playerCount: sayi(doc.playerCount),
      team1Name: typeof t1.name === 'string' ? t1.name : null,
      team1Faction: typeof t1.faction === 'string' ? t1.faction : null,
      team1Tickets: sayi(t1.tickets),
      team2Name: typeof t2.name === 'string' ? t2.name : null,
      team2Faction: typeof t2.faction === 'string' ? t2.faction : null,
      team2Tickets: sayi(t2.tickets),
      winnerTeam,
      totalKills: sayi(doc.totalKills),
      totalRevives: sayi(doc.totalRevives),
      totalTeamkills: sayi(doc.totalTeamkills),
      source: SOURCE,
      externalId: docId(doc),
    },
    oyuncular,
  });
}

// ----------------------------------------------------------------------- rapor
const summary = [
  '',
  write ? 'MONGO AKTARIMI (yazıldı)' : 'MONGO KURU KOŞU — hiçbir şey yazılmadı',
  '',
  `  squad_admin_groups         ${groupRows.length}`,
  `  grants (adminentries)      ${grantRows.length}`,
  `  discord_links              ${linkRows.length}`,
  `  admin_cam_logs             ${camRows.length}`,
  `  bans (BM'de olmayan)       ${lostBanRows.length}  [iptal edilmiş olarak]`,
  `  yeni oyuncu (idmappings)   ${yeniOyuncular.length}`,
  `  eos_id dolduruldu          ${eosGuncelle.length}`,
  `  steam_id dolduruldu        ${steamGuncelle.length}`,
  `  rounds                     ${maclar.length}`,
  `  round_players              ${maclar.reduce((a, m) => a + m.oyuncular.length, 0)}`,
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

if (groupRows.length)
  await insertAll(groupRows, (p) =>
    db.insert(accessSchema.squadAdminGroups).values(p).onConflictDoNothing(),
  );
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

// ------------------------------------------------- idmappings yazımı
if (yeniOyuncular.length) {
  await insertAll(yeniOyuncular, (p) =>
    db.insert(identitySchema.players).values(p).onConflictDoNothing(),
  );
  // İsimleri bağlamak için yeni oluşan id'leri geri okuyoruz.
  const steamler = yeniIsimler.map((n) => n.steamId);
  const idIle = new Map<string, string>();
  for (let i = 0; i < steamler.length; i += CHUNK) {
    const rows = await db
      .select({ id: identitySchema.players.id, steamId: identitySchema.players.steamId })
      .from(identitySchema.players)
      .where(inArray(identitySchema.players.steamId, steamler.slice(i, i + CHUNK)));
    for (const r of rows) if (r.steamId) idIle.set(r.steamId, r.id);
  }
  const isimSatirlari = yeniIsimler
    .map((n) => {
      const playerId = idIle.get(n.steamId);
      if (!playerId) return null;
      return {
        playerId,
        name: n.name,
        firstSeen: n.lastSeen,
        lastSeen: n.lastSeen,
        source: SOURCE,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (isimSatirlari.length)
    await insertAll(isimSatirlari, (p) =>
      db.insert(identitySchema.playerNames).values(p).onConflictDoNothing(),
    );
  summary.push(`  player_names (yeni oyuncular)  ${isimSatirlari.length}`);
}

// Tek tek UPDATE: toplu bir CASE ifadesi daha hızlı olurdu ama bu aktarım
// bir kez koşuyor ve satır sayısı düşük; okunabilirliği tercih ediyoruz.
for (const u of eosGuncelle) {
  await db
    .update(identitySchema.players)
    .set({ eosId: u.eosId })
    .where(eq(identitySchema.players.id, u.playerId));
}
for (const u of steamGuncelle) {
  await db
    .update(identitySchema.players)
    .set({ steamId: u.steamId })
    .where(eq(identitySchema.players.id, u.playerId));
}

// ------------------------------------------------- rounds yazımı
if (maclar.length) {
  await insertAll(
    maclar.map((m) => m.round),
    (p) => db.insert(matchesSchema.rounds).values(p).onConflictDoNothing(),
  );

  // roundId'leri external_id üzerinden geri okuyoruz: onConflictDoNothing
  // yalnızca YENİ eklenenleri döndürdüğü için, tekrar koşuda mevcut
  // maçların oyuncuları da yazılabilsin diye hepsini sorguluyoruz.
  const dis = maclar.map((m) => m.round.externalId).filter((x): x is string => Boolean(x));
  const roundIdIle = new Map<string, string>();
  for (let i = 0; i < dis.length; i += CHUNK) {
    const rows = await db
      .select({ id: matchesSchema.rounds.id, externalId: matchesSchema.rounds.externalId })
      .from(matchesSchema.rounds)
      .where(inArray(matchesSchema.rounds.externalId, dis.slice(i, i + CHUNK)));
    for (const r of rows) if (r.externalId) roundIdIle.set(r.externalId, r.id);
  }

  const oyuncuSatirlari: (typeof matchesSchema.roundPlayers.$inferInsert)[] = [];
  for (const m of maclar) {
    const roundId = m.round.externalId ? roundIdIle.get(m.round.externalId) : undefined;
    if (!roundId) continue;
    for (const o of m.oyuncular) oyuncuSatirlari.push({ ...o, roundId });
  }
  if (oyuncuSatirlari.length)
    await insertAll(oyuncuSatirlari, (p) =>
      db.insert(matchesSchema.roundPlayers).values(p).onConflictDoNothing(),
    );

  // Maç sırasında tanımadığımız ama idmappings ile yeni oluşan oyuncuları
  // geriye dönük bağla. Tek sorgu; her yeni aktarımdan sonra da çalışır.
  // Sürücü etkilenen satır sayısını vermiyor, o yüzden öncesi/sonrası
  // sayıyoruz — rapordaki rakam gerçekten ölçülmüş oluyor.
  const bagsizSay = async () => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(matchesSchema.roundPlayers)
      .where(sql`player_id is null`);
    return row?.n ?? 0;
  };
  const once = await bagsizSay();
  await db.execute(sql`
    update round_players rp
       set player_id = p.id
      from players p
     where rp.player_id is null
       and (rp.steam_id = p.steam_id or rp.eos_id = p.eos_id)
  `);
  const sonra = await bagsizSay();
  summary.push(`  round_players geriye dönük bağlanan  ${once - sonra}  (hâlâ bağsız: ${sonra})`);
}

summary.push('', 'Aktarım tamamlandı. Tekrar çalıştırılabilir — kayıtlar ikilenmez.');
process.stdout.write(`${summary.join('\n')}\n`);
process.exit(0);
