import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { chatSchema, createDb, identitySchema } from '@altai/db';
import { logger } from '@altai/shared';
import { sql } from 'drizzle-orm';
import { classifyId, docId, toDate } from './parse.js';

/**
 * Eski sistemin sohbet geçmişini aktarır (Mongo `chatlogs`).
 *
 * Ana aktarımdan AYRI: 260 bin satır, diğer koleksiyonların toplamının
 * birkaç katı. Hepsini belleğe alıp sonra yazmak yerine akış hâlinde
 * yazıyoruz — aynı dosyada olsaydı diğer dilimlerin okunurluğunu bozardı.
 *
 * Kullanım:
 *   MONGO_DUMP_DIR=... pnpm mongo:chat            kuru koşu
 *   MONGO_DUMP_DIR=... pnpm mongo:chat -- --write gerçek aktarım
 */

const args = process.argv.slice(2).filter((a) => a !== '--');
const write = args.includes('--write');

const dumpDir = process.env.MONGO_DUMP_DIR ?? './mongo-dump';
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  logger.error('DATABASE_URL tanımlı değil');
  process.exit(1);
}
const dosya = path.join(dumpDir, 'chatlogs.json');
if (!existsSync(dosya)) {
  logger.error({ dosya }, 'chatlogs.json bulunamadı');
  process.exit(1);
}

const SOURCE = 'mongo';
const CHUNK = 1_000;

/** SquadJS kanal adları -> bizim kısa adlarımız. */
const KANAL: Record<string, string> = {
  ChatAll: 'All',
  ChatTeam: 'Team',
  ChatSquad: 'Squad',
  ChatAdmin: 'Admin',
};

const db = createDb(databaseUrl);

logger.info('oyuncu dizini okunuyor');
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
logger.info({ steam: bySteam.size, eos: byEos.size }, 'dizin hazır');

const stats = {
  okunan: 0,
  bozuk: 0,
  mesajsiz: 0,
  tarihsiz: 0,
  yazilacak: 0,
  oyuncuBulundu: 0,
  oyuncuYok: 0,
};

let tampon: (typeof chatSchema.chatMessages.$inferInsert)[] = [];
let yazilan = 0;

async function bosalt() {
  if (tampon.length === 0) return;
  const batch = tampon;
  tampon = [];
  if (!write) return;
  await db.insert(chatSchema.chatMessages).values(batch).onConflictDoNothing();
  yazilan += batch.length;
  if (yazilan % 50_000 === 0) logger.info({ yazilan }, 'ilerleme');
}

const lines = createInterface({
  input: createReadStream(dosya, { encoding: 'utf8' }),
  crlfDelay: Number.POSITIVE_INFINITY,
});

for await (const line of lines) {
  if (!line.trim()) continue;
  stats.okunan++;

  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(line) as Record<string, unknown>;
  } catch {
    stats.bozuk++;
    continue;
  }

  // Kimlik ve kanal `raw` alanının içindeki JSON'da; üst seviyede yalnızca
  // isim ve mesaj var.
  let ham: Record<string, unknown> = {};
  try {
    ham = typeof doc.raw === 'string' ? (JSON.parse(doc.raw) as Record<string, unknown>) : {};
  } catch {
    // raw bozuksa mesajı yine alıyoruz, sadece kimliksiz kalıyor.
  }

  const message = typeof doc.message === 'string' ? doc.message : '';
  if (!message) {
    stats.mesajsiz++;
    continue;
  }
  const sentAt = toDate(doc.timestamp) ?? toDate(ham.time);
  if (!sentAt) {
    stats.tarihsiz++;
    continue;
  }

  const { steamId } = classifyId(String(ham.steamID ?? ''));
  const { eosId } = classifyId(String(ham.eosID ?? ''));
  const playerId =
    (steamId ? bySteam.get(steamId) : undefined) ?? (eosId ? byEos.get(eosId) : undefined) ?? null;
  if (playerId) stats.oyuncuBulundu++;
  else stats.oyuncuYok++;

  const kanalHam = typeof ham.chat === 'string' ? ham.chat : '';

  tampon.push({
    // Eski sistem sunucu bilgisini KAYDETMEMİŞ. Uydurmak yerine null
    // bırakıyoruz: yanlış sunucuya etiketlenmiş mesaj, etiketsiz mesajdan
    // daha kötü.
    serverId: null,
    playerId,
    steamId: steamId ?? null,
    eosId: eosId ?? null,
    name: typeof doc.player === 'string' ? doc.player : null,
    channel: KANAL[kanalHam] ?? kanalHam ?? null,
    message,
    sentAt,
    source: SOURCE,
    externalId: docId(doc),
  });
  stats.yazilacak++;

  if (tampon.length >= CHUNK) await bosalt();
}
await bosalt();

// Aktarım sırasında tanınmayan oyuncular sonradan oluşmuş olabilir.
let baglanan = 0;
if (write) {
  const [once] = (await db.execute(
    sql`select count(*)::int as n from chat_messages where player_id is null`,
  )) as unknown as { n: number }[];
  await db.execute(sql`
    update chat_messages c
       set player_id = p.id
      from players p
     where c.player_id is null
       and (c.steam_id = p.steam_id or c.eos_id = p.eos_id)
  `);
  const [sonra] = (await db.execute(
    sql`select count(*)::int as n from chat_messages where player_id is null`,
  )) as unknown as { n: number }[];
  baglanan = (once?.n ?? 0) - (sonra?.n ?? 0);
}

const rapor = [
  '',
  write ? 'SOHBET AKTARIMI (yazıldı)' : 'SOHBET KURU KOŞU — hiçbir şey yazılmadı',
  '',
  `  okunan satır          ${stats.okunan.toLocaleString('tr-TR')}`,
  `  yazılacak mesaj       ${stats.yazilacak.toLocaleString('tr-TR')}`,
  `  oyuncuya bağlanan     ${stats.oyuncuBulundu.toLocaleString('tr-TR')}`,
  `  oyuncusu bulunamayan  ${stats.oyuncuYok.toLocaleString('tr-TR')}`,
  `  bozuk satır           ${stats.bozuk}`,
  `  mesajı boş            ${stats.mesajsiz}`,
  `  tarihi yok            ${stats.tarihsiz}`,
];
if (write) {
  rapor.push(`  yazılan               ${yazilan.toLocaleString('tr-TR')}`);
  rapor.push(`  geriye dönük bağlanan ${baglanan.toLocaleString('tr-TR')}`);
} else {
  rapor.push('', 'Yazmak için: pnpm mongo:chat -- --write');
}
process.stdout.write(`${rapor.join('\n')}\n`);
process.exit(0);
