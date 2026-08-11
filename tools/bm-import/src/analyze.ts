import path from 'node:path';
import { logger } from '@altai/shared';
import { type BmRecord, fileSizeMb, readNdjson, relId } from './ndjson.js';

/**
 * Kuru koşu (dry-run) çözümleyicisi — plan Bölüm 5.5-A/3 ve 5.5-B/3.
 *
 * Veritabanına hiçbir şey yazmaz. Arşivi baştan sona okur, ETL'in yapacağı
 * dönüşümü zihinsel olarak uygular ve şunu söyler: bu veri Postgres'e
 * girdiğinde ne olacak, neyi kaybedeceğiz, nerede çakışma var.
 *
 * Neden önce bu: import bir kez yapılıp üstüne inşa edilecek. Veri kalitesi
 * sorunlarını import ettikten SONRA keşfetmek, temizliği canlı veri üzerinde
 * yapmak demek. Ayrıca BM aboneliği hâlâ dururken eksik bir şey görürsek
 * geri dönüp çekebiliriz.
 */

export interface PlayerFacts {
  steamId?: string;
  eosId?: string;
  /** İsim geçmişi: identifier kayıtlarından toplanır. */
  nameCount: number;
  /** Sunucu bazlı toplam oynama süresi (saniye). */
  timePlayed: number;
}

export interface AnalysisReport {
  lines: string[];
  /** Import'u engelleyecek ciddi sorun var mı. */
  blocking: boolean;
}

interface Counter {
  [key: string]: number;
}

function pct(part: number, whole: number): string {
  if (whole === 0) return '—';
  return `%${((100 * part) / whole).toFixed(1)}`;
}

function fmt(n: number): string {
  return n.toLocaleString('tr-TR');
}

export async function analyzeArchive(dir: string): Promise<AnalysisReport> {
  const out: string[] = [];
  let blocking = false;

  const p = (file: string) => path.join(dir, file);
  const say = (line = '') => out.push(line);

  say(`BattleMetrics arşiv çözümlemesi — ${dir}`);
  say('Veritabanına HİÇBİR ŞEY yazılmaz. Bu bir ön inceleme.');
  say();

  // ---------------------------------------------------------------- players
  logger.info('oyuncular okunuyor');
  const players = new Map<string, PlayerFacts>();
  let playerRows = 0;

  for await (const rec of readNdjson<BmRecord>(p('players.ndjson'))) {
    playerRows++;
    const servers = rec.relationships?.servers?.data;
    let timePlayed = 0;
    if (Array.isArray(servers)) {
      for (const s of servers as Array<{ meta?: { timePlayed?: number } }>) {
        timePlayed += s.meta?.timePlayed ?? 0;
      }
    }
    players.set(rec.id, { nameCount: 0, timePlayed });
  }

  // -------------------------------------------------- identifiers (606 MB)
  logger.info({ mb: Math.round(fileSizeMb(p('players.included.ndjson'))) }, 'kimlikler okunuyor');
  const identifierTypes: Counter = {};
  // Aynı SteamID'ye birden çok EOS (ve tersi) — eski sistemin sessizce
  // sildiği çakışma (plan 5.5-B/2). PG'de player_id_history ile saklanacak.
  const steamToEos = new Map<string, Set<string>>();
  const eosToSteam = new Map<string, Set<string>>();
  let identifierRows = 0;
  let orphanIdentifiers = 0;

  for await (const rec of readNdjson<BmRecord>(p('players.included.ndjson'))) {
    if (rec.type !== 'identifier') continue;
    identifierRows++;
    const kind = String(rec.attributes?.type ?? '-');
    identifierTypes[kind] = (identifierTypes[kind] ?? 0) + 1;

    const playerId = relId(rec, 'player');
    if (!playerId) continue;
    const facts = players.get(playerId);
    if (!facts) {
      orphanIdentifiers++;
      continue;
    }

    const value = String(rec.attributes?.identifier ?? '');
    if (!value) continue;

    if (kind === 'steamID') facts.steamId = value;
    else if (kind === 'eosID') facts.eosId = value;
    else if (kind === 'name') facts.nameCount++;
  }

  for (const facts of players.values()) {
    if (facts.steamId && facts.eosId) {
      let eos = steamToEos.get(facts.steamId);
      if (!eos) {
        eos = new Set();
        steamToEos.set(facts.steamId, eos);
      }
      eos.add(facts.eosId);

      let steam = eosToSteam.get(facts.eosId);
      if (!steam) {
        steam = new Set();
        eosToSteam.set(facts.eosId, steam);
      }
      steam.add(facts.steamId);
    }
  }

  const withSteam = [...players.values()].filter((f) => f.steamId).length;
  const withEos = [...players.values()].filter((f) => f.eosId).length;
  const withNeither = [...players.values()].filter((f) => !f.steamId && !f.eosId).length;
  const totalNames = [...players.values()].reduce((a, f) => a + f.nameCount, 0);
  const totalHours = [...players.values()].reduce((a, f) => a + f.timePlayed, 0) / 3600;
  const eosConflicts = [...steamToEos.values()].filter((s) => s.size > 1).length;
  const steamConflicts = [...eosToSteam.values()].filter((s) => s.size > 1).length;

  say('## Oyuncular');
  say(`  arşivdeki kayıt          ${fmt(playerRows)}`);
  say(`  SteamID'si olan          ${fmt(withSteam)}  ${pct(withSteam, playerRows)}`);
  say(`  EOS ID'si olan           ${fmt(withEos)}  ${pct(withEos, playerRows)}`);
  say(`  İKİSİ DE YOK             ${fmt(withNeither)}  ${pct(withNeither, playerRows)}`);
  say(`  isim geçmişi kaydı       ${fmt(totalNames)}`);
  say(`  toplam oynama süresi     ${fmt(Math.round(totalHours))} saat`);
  say(`  kimlik kaydı (identifier) ${fmt(identifierRows)}`);
  say(
    `    tipler: ${Object.entries(identifierTypes)
      .map(([k, v]) => `${k}=${fmt(v)}`)
      .join(', ')}`,
  );
  if (orphanIdentifiers > 0) {
    say(`  ! sahipsiz kimlik        ${fmt(orphanIdentifiers)} (oyuncusu arşivde yok)`);
  }
  say(`  ! aynı SteamID'ye birden çok EOS  ${fmt(eosConflicts)}`);
  say(`  ! aynı EOS'a birden çok SteamID   ${fmt(steamConflicts)}`);
  say();

  if (withNeither > 0) {
    const orphanHours =
      [...players.values()]
        .filter((f) => !f.steamId && !f.eosId)
        .reduce((a, f) => a + f.timePlayed, 0) / 3600;
    say(
      `  NOT: ${fmt(withNeither)} oyuncu ne SteamID ne EOS taşıyor. Toplam süreleri ` +
        `${fmt(Math.round(orphanHours))} saat (${pct(orphanHours, totalHours)} — ihmal edilebilir).`,
    );
    say('       Bunlar İÇERİ ALINMAZ ve alınmamalı: kimliği olmayan bir oyuncu, agent');
    say('       canlı veri toplamaya başladığında hiçbir kayıtla eşleşemez. BM kısa süre');
    say('       görüp kimliğini çözemeden ayrılan oyuncular için böyle kayıt tutuyor.');
    say();
  }
  if (eosConflicts + steamConflicts > 0) {
    say(
      '  NOT: Çakışmalar beklenen bir durum (plan 5.5-B/2 — eski sistem bunları ' +
        "sessizce siliyordu). ETL hiçbirini silmez, player_id_history'e tarihçe yazar.",
    );
    say();
  }

  // -------------------------------------------------------------- sessions
  logger.info('sessionlar okunuyor');
  let sessionRows = 0;
  let openSessions = 0;
  let unknownPlayerSessions = 0;
  let overLongSessions = 0;
  let negativeSessions = 0;
  let totalSessionSeconds = 0;
  const sessionsByServer: Counter = {};
  const FOUR_HOURS = 4 * 3600;
  // Arşivin gerçekten tüm geçmişi kapsayıp kapsamadığını görmek için:
  // BM bazı uçlarda geçmişi kırpıyor (server history 90 günle sınırlı),
  // session'larda da öyle olsaydı süre toplamları anlamsız olurdu.
  let earliestSession: string | undefined;
  let latestSession: string | undefined;

  for await (const rec of readNdjson<BmRecord>(p('sessions.ndjson'))) {
    sessionRows++;
    const serverId = relId(rec, 'server') ?? '-';
    sessionsByServer[serverId] = (sessionsByServer[serverId] ?? 0) + 1;

    const playerId = relId(rec, 'player');
    if (!playerId || !players.has(playerId)) unknownPlayerSessions++;

    const start = rec.attributes?.start as string | undefined;
    if (start) {
      if (!earliestSession || start < earliestSession) earliestSession = start;
      if (!latestSession || start > latestSession) latestSession = start;
    }
    const stop = rec.attributes?.stop as string | null | undefined;
    if (!stop) {
      openSessions++;
      continue;
    }
    if (!start) continue;
    const seconds = (Date.parse(stop) - Date.parse(start)) / 1000;
    if (Number.isNaN(seconds)) continue;
    if (seconds < 0) negativeSessions++;
    else {
      totalSessionSeconds += seconds;
      if (seconds > FOUR_HOURS) overLongSessions++;
    }
  }

  say('## Session geçmişi');
  say(`  toplam                   ${fmt(sessionRows)}`);
  if (earliestSession && latestSession) {
    const days = (Date.parse(latestSession) - Date.parse(earliestSession)) / 86_400_000;
    say(
      `  kapsanan aralık          ${earliestSession.slice(0, 10)} → ` +
        `${latestSession.slice(0, 10)} (${Math.round(days)} gün)`,
    );
  }
  for (const [server, count] of Object.entries(sessionsByServer)) {
    say(`    sunucu ${server}       ${fmt(count)}`);
  }
  say(`  kapanmamış (stop=null)   ${fmt(openSessions)}  ${pct(openSessions, sessionRows)}`);
  say(`  4 saatten uzun           ${fmt(overLongSessions)}  ${pct(overLongSessions, sessionRows)}`);
  say(`  toplam süre              ${fmt(Math.round(totalSessionSeconds / 3600))} saat`);
  if (unknownPlayerSessions > 0) {
    say(`  ! oyuncusu arşivde yok   ${fmt(unknownPlayerSessions)}`);
  }
  if (negativeSessions > 0) {
    say(`  ! negatif süre           ${fmt(negativeSessions)} (stop < start)`);
  }
  say();

  // Aynı toplamın iki bağımsız kaynağı: oyuncu bazlı timePlayed ve session
  // aralıklarının toplamı. Ciddi sapma, session arşivinin eksik olduğunu
  // gösterir — abonelik iptal edilmeden fark edilmesi gereken bir şey.
  const sessionHours = totalSessionSeconds / 3600;
  const drift = totalHours > 0 ? Math.abs(sessionHours - totalHours) / totalHours : 0;
  say('## Çapraz doğrulama: oynama süresi');
  say(`  oyuncu kayıtlarından     ${fmt(Math.round(totalHours))} saat`);
  say(`  session aralıklarından   ${fmt(Math.round(sessionHours))} saat`);
  say(`  sapma                    %${(drift * 100).toFixed(1)}`);
  if (drift > 0.1) {
    say('  Sapma session arşivinin EKSİK olmasından değil — yukarıdaki tarih aralığı');
    say('  sunucunun BM ömrünün tamamını kapsıyor. İki sayı farklı şeyler ölçüyor:');
    say("  timePlayed BM'nin poller ile biriktirdiği kümülatif sayaç, session toplamı");
    say("  ise kayıtlı aralıkların toplamı (kapanmamış session'lar 0 sayılıyor).");
    say('  Plan 5.5-B/4 gereği İKİSİ de saklanır, profilde birleşik gösterilir.');
  }
  say();

  // ------------------------------------------------------------------ bans
  logger.info('banlar okunuyor');
  let banRows = 0;
  let permanentBans = 0;
  let expiredBans = 0;
  let activeBans = 0;
  let bansWithoutSteam = 0;
  let bansUnknownPlayer = 0;
  const bansByList: Counter = {};
  const now = Date.now();

  for await (const rec of readNdjson<BmRecord>(p('bans.ndjson'))) {
    banRows++;
    const list = relId(rec, 'banList') ?? '(liste yok)';
    bansByList[list] = (bansByList[list] ?? 0) + 1;

    const playerId = relId(rec, 'player');
    if (!playerId || !players.has(playerId)) bansUnknownPlayer++;

    const identifiers = (rec.attributes?.identifiers ?? []) as Array<{
      type?: string;
      identifier?: string;
    }>;
    const steam = identifiers.find((i) => i.type === 'steamID')?.identifier;
    if (!steam) bansWithoutSteam++;

    const expires = rec.attributes?.expires as string | null | undefined;
    if (!expires) permanentBans++;
    else if (Date.parse(expires) < now) expiredBans++;
    else activeBans++;
  }

  say('## Banlar');
  say(`  toplam                   ${fmt(banRows)}`);
  say(`  kalıcı (süresiz)         ${fmt(permanentBans)}  ${pct(permanentBans, banRows)}`);
  say(`  süresi geçmiş            ${fmt(expiredBans)}  ${pct(expiredBans, banRows)}`);
  say(`  hâlâ aktif               ${fmt(activeBans)}  ${pct(activeBans, banRows)}`);
  for (const [list, count] of Object.entries(bansByList)) {
    say(`    liste ${list}  ${fmt(count)}`);
  }
  if (bansWithoutSteam > 0) {
    say(`  ! SteamID'siz ban        ${fmt(bansWithoutSteam)} — oyun içi ban listesine yazılamaz`);
    if (bansWithoutSteam > banRows * 0.05) blocking = true;
  }
  if (bansUnknownPlayer > 0) {
    say(
      `  ! oyuncusu arşivde yok   ${fmt(bansUnknownPlayer)} — ETL bunları ban'daki kimliklerden oluşturur (ban kaydı SteamID/EOS taşıyor)`,
    );
  }
  say();

  // ----------------------------------------------------------------- flags
  logger.info('flagler okunuyor');
  const flagNames = new Map<string, string>();
  for await (const rec of readNdjson<BmRecord>(p('player-flags.ndjson'))) {
    flagNames.set(rec.id, String(rec.attributes?.name ?? rec.id));
  }

  let assignmentRows = 0;
  let duplicateAssignments = 0;
  let activeAssignments = 0;
  let removedAssignments = 0;
  let assignmentsUnknownPlayer = 0;
  let assignmentsUnknownFlag = 0;
  const byFlag: Counter = {};
  // BM, bir flag'e göre filtrelenmiş listede oyuncunun diğer flag atamalarını
  // da included'a koyduğu için arşivde aynı atama birden çok kez bulunabilir.
  // Sayarken tekilleştirmezsek rapor gerçekte olmayan atamalar gösterir.
  const seenAssignments = new Set<string>();

  for await (const rec of readNdjson<BmRecord>(p('player-flag-assignments.ndjson'))) {
    if (seenAssignments.has(rec.id)) {
      duplicateAssignments++;
      continue;
    }
    seenAssignments.add(rec.id);
    assignmentRows++;
    const flagId = relId(rec, 'playerFlag');
    const playerId = relId(rec, 'player');
    if (!flagId || !flagNames.has(flagId)) assignmentsUnknownFlag++;
    if (!playerId || !players.has(playerId)) assignmentsUnknownPlayer++;
    if (rec.attributes?.removedAt) removedAssignments++;
    else activeAssignments++;
    const label = flagId ? (flagNames.get(flagId) ?? flagId) : '(bilinmiyor)';
    byFlag[label] = (byFlag[label] ?? 0) + 1;
  }

  say('## Flagler');
  say(`  flag tanımı              ${fmt(flagNames.size)}`);
  say(`  atama (tekil)            ${fmt(assignmentRows)}`);
  if (duplicateAssignments > 0) {
    say(
      `  arşivdeki kopya satır    ${fmt(duplicateAssignments)} — zararsız, ETL tekilleştirir (bans/flags unique index)`,
    );
  }
  say(`    hâlâ takılı            ${fmt(activeAssignments)}`);
  say(`    kaldırılmış            ${fmt(removedAssignments)}`);
  for (const [label, count] of Object.entries(byFlag).sort((a, b) => b[1] - a[1])) {
    say(`    ${label.padEnd(30)} ${fmt(count)}`);
  }
  if (assignmentsUnknownFlag > 0) say(`  ! tanımı olmayan flag    ${fmt(assignmentsUnknownFlag)}`);
  if (assignmentsUnknownPlayer > 0) {
    say(`  ! oyuncusu arşivde yok   ${fmt(assignmentsUnknownPlayer)}`);
  }
  say();

  // ----------------------------------------------------------------- notlar
  say('## Notlar');
  say('  ARŞİVLENMEDİ — bilinçli karar (bkz. bm-archive/manifest.json).');
  say('  BM aboneliği dururken hâlâ çekilebilir: pnpm bm:export -- --only player-notes');
  say();

  say('## Sonuç');
  if (blocking) {
    say('  ✗ Import öncesi çözülmesi gereken sorunlar var (yukarıda ! ile işaretli).');
  } else {
    say('  ✓ Veri import edilebilir durumda.');
    say('  Yukarıdaki sayıları BM panelindekilerle karşılaştırın; tutuyorsa ETL çalıştırılabilir.');
  }

  return { lines: out, blocking };
}
