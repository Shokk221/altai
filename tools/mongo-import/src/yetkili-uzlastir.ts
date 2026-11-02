import { accessSchema, createDb, identitySchema } from '@altai/db';
import type { Db } from '@altai/db';
import { logger } from '@altai/shared';
import { and, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { defaultGrantMode } from './parse.js';
import {
  type Cift,
  type KaynakUye,
  adminsCfgAyristir,
  cift,
  grantFarki,
  kaynakSagligi,
} from './yetkili-fark.js';

/**
 * Eski sistemin yayınladığı yetkili listesiyle bizim grant'larımızı
 * uzlaştırır. Gerekçe ve sınırlar: `yetkili-fark.ts` başlığı.
 *
 * Kullanım:
 *   pnpm yetkili:uzlastir                          kuru koşu (varsayılan)
 *   pnpm yetkili:uzlastir -- --write                uygula
 *   pnpm yetkili:uzlastir -- --write --dusurmeyi-onayla
 *                                                  büyük temizliği de uygula
 *
 * `DATABASE_URL` şart. Kaynak adres `ESKI_YETKILI_URL` ile değiştirilebilir.
 */

const args = process.argv.slice(2).filter((a) => a !== '--');
const yaz = args.includes('--write');
const dusurmeyiOnayla = args.includes('--dusurmeyi-onayla');

const KAYNAK_URL =
  process.env.ESKI_YETKILI_URL ?? 'https://altaisquad.com/api/remote-admin-list.cfg';

const bilgi = (...s: unknown[]) => console.log(...s);

async function kaynagiIndir(url: string): Promise<string> {
  const cevap = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!cevap.ok) throw new Error(`kaynak liste indirilemedi: HTTP ${cevap.status}`);
  const metin = await cevap.text();
  if (metin.trim().length === 0) throw new Error('kaynak liste boş geldi');
  return metin;
}

/** Kaynaktaki kimliği oyuncuya bağlar; `null` = bizde böyle bir oyuncu yok. */
async function kimlikleriCoz(db: Db, kimlikler: string[]): Promise<Map<string, string>> {
  const harita = new Map<string, string>();
  const PARCA = 500;
  for (let i = 0; i < kimlikler.length; i += PARCA) {
    const dilim = kimlikler.slice(i, i + PARCA);
    const satirlar = await db
      .select({
        id: identitySchema.players.id,
        steamId: identitySchema.players.steamId,
        eosId: identitySchema.players.eosId,
      })
      .from(identitySchema.players)
      .where(
        or(
          inArray(identitySchema.players.steamId, dilim),
          inArray(identitySchema.players.eosId, dilim),
        ),
      );
    for (const p of satirlar) {
      if (p.steamId) harita.set(p.steamId, p.id);
      if (p.eosId) harita.set(p.eosId, p.id);
    }
  }
  return harita;
}

/** 17 hane = SteamID, 32 hex = EOS. Başkasını tanımıyoruz. */
const kimlikTuru = (k: string): 'steam' | 'eos' | null => {
  if (/^7656119\d{10}$/.test(k)) return 'steam';
  if (/^[0-9a-f]{32}$/i.test(k)) return 'eos';
  return null;
};

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    logger.error('DATABASE_URL tanımlı değil');
    process.exit(1);
  }
  const db = createDb(url);

  bilgi(`kaynak: ${KAYNAK_URL}`);
  const kaynak = adminsCfgAyristir(await kaynagiIndir(KAYNAK_URL));

  // --- bizdeki gruplar: hangi grup elle verilebilir ---
  const gruplar = await db
    .select({
      name: accessSchema.squadAdminGroups.name,
      grantMode: accessSchema.squadAdminGroups.grantMode,
      serverId: accessSchema.squadAdminGroups.serverId,
    })
    .from(accessSchema.squadAdminGroups);
  const kipByAd = new Map(gruplar.map((g) => [g.name, g.grantMode]));

  // --- bizdeki AKTİF grant'lar ---
  const simdi = new Date();
  const grantlar = await db
    .select({
      id: accessSchema.grants.id,
      playerId: accessSchema.grants.playerId,
      groupName: accessSchema.grants.groupName,
    })
    .from(accessSchema.grants)
    .where(
      and(
        isNull(accessSchema.grants.revokedAt),
        or(isNull(accessSchema.grants.expiresAt), gt(accessSchema.grants.expiresAt, simdi)),
        isNull(accessSchema.grants.serverId),
      ),
    );

  const saglik = kaynakSagligi(kaynak, new Set(grantlar.map((g) => g.playerId)).size);

  // --- kaynak üyelerini sınıflandır ---
  const cozum = await kimlikleriCoz(db, [...new Set(kaynak.uyeler.map((u) => u.kimlik))]);

  const eksikGruplar = kaynak.gruplar.filter((g) => !kipByAd.has(g.ad) && !g.ad.startsWith('//'));
  /** Yetkili gruba düşen kaynak üyeleri — ASLA yazılmaz, yalnızca raporlanır. */
  const yetkiliRapor: KaynakUye[] = [];
  /** Bizde hiç oyuncusu olmayan kimlikler. */
  const oyuncusuzlar: KaynakUye[] = [];
  const kaynakCiftleri = new Set<Cift>();

  for (const u of kaynak.uyeler) {
    // Eksik grup eklenecekse kipini şimdiden biliyoruz.
    const eksik = eksikGruplar.find((g) => g.ad === u.grup);
    const kip = kipByAd.get(u.grup) ?? (eksik ? defaultGrantMode(eksik.yetkiler) : undefined);
    if (kip === 'discord') {
      yetkiliRapor.push(u);
      continue;
    }
    if (kip === undefined) {
      // Grup ne bizde var ne kaynakta tanımlı — biçim sorunu, atlıyoruz.
      yetkiliRapor.push(u);
      continue;
    }
    const playerId = cozum.get(u.kimlik);
    if (!playerId) {
      oyuncusuzlar.push(u);
      continue;
    }
    kaynakCiftleri.add(cift(playerId, u.grup));
  }

  // Bizdeki çiftlerden YALNIZCA elle verilebilir gruplar karşılaştırılıyor:
  // Discord'dan gelen yetkiler grant tablosunda durmuyor, dolayısıyla
  // yetkili gruba düşmüş bir grant zaten reddedilen bir yapılandırma
  // hatası — onu "kaynakta yok" diye düşürmek doğru olurdu ama bu aracın
  // işi değil; karıştırmamak için kapsam dışı.
  const bizdekiCiftler = new Set<Cift>();
  const grantByCift = new Map<Cift, string[]>();
  for (const g of grantlar) {
    if (kipByAd.get(g.groupName) === 'discord') continue;
    const c = cift(g.playerId, g.groupName);
    bizdekiCiftler.add(c);
    const liste = grantByCift.get(c);
    if (liste) liste.push(g.id);
    else grantByCift.set(c, [g.id]);
  }

  const fark = grantFarki(kaynakCiftleri, bizdekiCiftler);

  // ------------------------------------------------------------- rapor
  bilgi('');
  bilgi(yaz ? 'YETKİLİ UZLAŞTIRMA — UYGULANIYOR' : 'YETKİLİ UZLAŞTIRMA — KURU KOŞU');
  bilgi(`  kaynak üye satırı      ${kaynak.uyeler.length}`);
  bilgi(`  kaynak grup tanımı     ${kaynak.gruplar.length}`);
  bilgi(`  bizdeki aktif grant    ${bizdekiCiftler.size}`);
  bilgi(`  eklenecek              ${fark.eklenecek.length}`);
  bilgi(`  düşecek                ${fark.dusecek.length}`);
  bilgi(`  değişmeyen             ${fark.ayni}`);
  if (eksikGruplar.length > 0) {
    bilgi(
      `  bizde OLMAYAN grup     ${eksikGruplar.length}: ${eksikGruplar
        .map((g) => `${g.ad}(${g.yetkiler || 'yetkisiz'})`)
        .join(', ')}`,
    );
  }
  if (oyuncusuzlar.length > 0) {
    bilgi(`  bizde oyuncusu yok     ${oyuncusuzlar.length} kimlik (yazarken oluşturulur)`);
  }
  if (yetkiliRapor.length > 0) {
    bilgi('');
    bilgi(`  YETKİLİ GRUPLAR — ${yetkiliRapor.length} kayıt, BU ARAÇ DOKUNMAZ.`);
    bilgi('  Admin/SuperAdmin yalnızca Discord rolünden gelir. Eski sistemde');
    bilgi('  elle eklenmiş bu kişilerin panelde yetkili olması için Discord');
    bilgi('  rolü + oyun hesabı bağı gerekiyor:');
    const grupla = new Map<string, KaynakUye[]>();
    for (const u of yetkiliRapor) {
      const l = grupla.get(u.grup);
      if (l) l.push(u);
      else grupla.set(u.grup, [u]);
    }
    for (const [g, us] of [...grupla].sort((a, b) => b[1].length - a[1].length)) {
      bilgi(`    ${g}: ${us.length} kişi — ${us.map((u) => u.not ?? u.kimlik).join(', ')}`);
    }
  }

  if (!saglik.guvenli) {
    bilgi('');
    bilgi(`  DURDURULDU: ${saglik.gerekce}`);
    bilgi('  Hiçbir şey değişmedi.');
    return;
  }

  if (fark.onayGerekli && !dusurmeyiOnayla) {
    bilgi('');
    bilgi(
      `  DİKKAT: aktif grant'ların %${Math.round(
        (fark.dusecek.length / Math.max(bizdekiCiftler.size, 1)) * 100,
      )}'i düşecek.`,
    );
    bilgi('  Düşürme ATLANIYOR. Listeye bakıp doğruysa --dusurmeyi-onayla ekleyin.');
  }

  if (!yaz) {
    bilgi('');
    bilgi('  (kuru koşu — hiçbir şey değişmedi; uygulamak için --write)');
    return;
  }

  // ------------------------------------------------------------- yazma
  let grupEklendi = 0;
  for (const g of eksikGruplar) {
    await db
      .insert(accessSchema.squadAdminGroups)
      .values({
        name: g.ad,
        squadPermissions: g.yetkiler,
        grantMode: defaultGrantMode(g.yetkiler),
        source: 'eski-yetkili',
        externalId: g.ad,
      })
      .onConflictDoNothing();
    grupEklendi++;
  }

  // Bizde oyuncusu olmayan kimlikler için oyuncu satırı açılıyor: whitelist
  // grant'ı bir oyuncuya bağlanmak zorunda. Kimliği tanımadığımız satırı
  // atlıyoruz — uydurma bir oyuncu açmak, listeyi sessizce bozmaktan kötü.
  let oyuncuEklendi = 0;
  for (const u of oyuncusuzlar) {
    const tur = kimlikTuru(u.kimlik);
    if (!tur) continue;
    const [yeniOyuncu] = await db
      .insert(identitySchema.players)
      .values(tur === 'steam' ? { steamId: u.kimlik } : { eosId: u.kimlik })
      .onConflictDoNothing()
      .returning({ id: identitySchema.players.id });
    if (yeniOyuncu) {
      oyuncuEklendi++;
      cozum.set(u.kimlik, yeniOyuncu.id);
      const kip = kipByAd.get(u.grup) ?? 'manual';
      if (kip !== 'discord') fark.eklenecek.push(cift(yeniOyuncu.id, u.grup));
    }
  }

  const notByCift = new Map<Cift, string>();
  for (const u of kaynak.uyeler) {
    const pid = cozum.get(u.kimlik);
    if (pid && u.not) notByCift.set(cift(pid, u.grup), u.not);
  }

  let eklendi = 0;
  for (const c of fark.eklenecek) {
    const [playerId, grup] = c.split('|') as [string, string];
    const not = notByCift.get(c);
    await db
      .insert(accessSchema.grants)
      .values({
        playerId,
        groupName: grup,
        origin: 'manual',
        source: 'eski-yetkili',
        externalId: c,
        ...(not ? { comment: not } : {}),
      })
      .onConflictDoNothing();
    eklendi++;
  }

  let dusuruldu = 0;
  if (!fark.onayGerekli || dusurmeyiOnayla) {
    const idler = fark.dusecek.flatMap((c) => grantByCift.get(c) ?? []);
    const PARCA = 500;
    for (let i = 0; i < idler.length; i += PARCA) {
      const dilim = idler.slice(i, i + PARCA);
      await db
        .update(accessSchema.grants)
        .set({ revokedAt: new Date() })
        .where(
          and(
            inArray(accessSchema.grants.id, dilim),
            // Yarıştan korunma: bu arada elle kaldırılmış olabilir.
            isNull(accessSchema.grants.revokedAt),
          ),
        );
      dusuruldu += dilim.length;
    }
  }

  bilgi('');
  bilgi(`  grup eklendi           ${grupEklendi}`);
  bilgi(`  oyuncu açıldı          ${oyuncuEklendi}`);
  bilgi(`  grant eklendi          ${eklendi}`);
  bilgi(`  grant düşürüldü        ${dusuruldu}`);

  logger.info(
    {
      kaynakUye: kaynak.uyeler.length,
      eklendi,
      dusuruldu,
      grupEklendi,
      oyuncuEklendi,
      yetkiliRapor: yetkiliRapor.length,
    },
    'yetkili uzlaştırma uygulandı',
  );
  process.exit(0);
}

main().catch((e) => {
  logger.error({ err: e }, 'yetkili uzlaştırma başarısız');
  process.exit(1);
});
