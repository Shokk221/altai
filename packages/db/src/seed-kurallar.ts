import { and, eq, isNull } from 'drizzle-orm';
import { createDb } from './client.js';
import { serverRules } from './schema/community.js';
import { ALTAI_KURALLARI } from './veri/altai-kurallari.js';

/**
 * Altai sunucu kurallarını veritabanına yazar.
 *
 * Kurallar `src/veri/altai-kurallari.ts` içinde, altaisquad.com'daki
 * metinle birebir. Bu betik onları `server_rules` tablosuna koyuyor.
 *
 * Kullanım:
 *   DATABASE_URL=... pnpm db:seed:kurallar [--kuru] [--sunucu <uuid>]
 *
 *   --kuru      hiçbir şey yazmaz, ne yapacağını listeler
 *   --sunucu    kuralları tek bir sunucuya bağlar; yoksa `server_id`
 *               NULL kalır (tüm sunucularda geçerli genel kural)
 *
 * TEKRAR ÇALIŞTIRILABİLİR. Eşleştirme KOD üzerinden (`title` alanı):
 *   - kod yoksa ekliyor,
 *   - varsa ve metni/bölümü/sırası değişmişse güncelliyor,
 *   - varsa ve aynıysa dokunmuyor.
 *
 * SİLMİYOR. Veritabanında olup bu dosyada olmayan bir kural varsa
 * yalnızca uyarıyor. Sebep: pasif kurallar geçmiş moderasyon
 * kayıtlarının dayanağı ("GEN-3'ten ban") ve elle eklenmiş sunucuya
 * özel kurallar olabilir. Silme kararı insanın.
 */

const args = process.argv.slice(2).filter((a) => a !== '--');
const kuru = args.includes('--kuru');

function arg(ad: string): string | undefined {
  const i = args.indexOf(`--${ad}`);
  return i === -1 ? undefined : args[i + 1];
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('\n  HATA: DATABASE_URL tanımlı değil\n');
  process.exit(1);
}

const sunucuId = arg('sunucu') ?? null;
if (sunucuId !== null && !/^[0-9a-f-]{36}$/i.test(sunucuId)) {
  console.error('\n  HATA: --sunucu bir uuid olmalı\n');
  process.exit(1);
}

const db = createDb(databaseUrl);

// Mevcut kurallar: kodla (title) eşleştirmek için.
const mevcut = await db
  .select()
  .from(serverRules)
  .where(sunucuId === null ? isNull(serverRules.serverId) : eq(serverRules.serverId, sunucuId));

const mevcutKodlar = new Map(mevcut.map((k) => [k.title, k]));

let eklenen = 0;
let guncellenen = 0;
let ayni = 0;

for (const kural of ALTAI_KURALLARI) {
  const var_ = mevcutKodlar.get(kural.kod);

  if (!var_) {
    console.log(`  + ${kural.kod.padEnd(12)} ${kural.bolum}`);
    eklenen += 1;
    if (!kuru) {
      await db.insert(serverRules).values({
        serverId: sunucuId,
        position: kural.sira,
        title: kural.kod,
        body: kural.metin,
        category: kural.bolum,
        active: true,
      });
    }
    continue;
  }

  const degisti =
    var_.body !== kural.metin || var_.category !== kural.bolum || var_.position !== kural.sira;

  if (!degisti) {
    ayni += 1;
    continue;
  }

  const neler = [
    var_.body !== kural.metin ? 'metin' : null,
    var_.category !== kural.bolum ? 'bölüm' : null,
    var_.position !== kural.sira ? 'sıra' : null,
  ].filter(Boolean);

  console.log(`  ~ ${kural.kod.padEnd(12)} değişen: ${neler.join(', ')}`);
  guncellenen += 1;
  if (!kuru) {
    await db
      .update(serverRules)
      .set({
        position: kural.sira,
        body: kural.metin,
        category: kural.bolum,
        updatedAt: new Date(),
      })
      .where(and(eq(serverRules.id, var_.id)));
  }
}

// Bu dosyada olmayan kurallar: silinmiyor, yalnızca söyleniyor.
const dosyadakiKodlar = new Set(ALTAI_KURALLARI.map((k) => k.kod));
const fazladan = mevcut.filter((k) => !dosyadakiKodlar.has(k.title));

console.log(
  `\n  ${eklenen} eklendi, ${guncellenen} güncellendi, ${ayni} değişmedi${kuru ? ' (KURU ÇALIŞMA — hiçbir şey yazılmadı)' : ''}`,
);

if (fazladan.length > 0) {
  console.log(`\n  Veritabanında olup bu dosyada OLMAYAN ${fazladan.length} kural var:`);
  for (const k of fazladan) {
    console.log(`    ${k.title.padEnd(12)} ${k.active ? 'aktif' : 'pasif'} · ${k.category ?? '—'}`);
  }
  console.log('  Silinmedi. Geçmiş moderasyon kayıtları bunlara atıfta bulunuyor olabilir.');
}

console.log();
process.exit(0);
