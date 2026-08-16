import type { Db } from '@altai/db';
import { identitySchema } from '@altai/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';

/**
 * Klan üyeliği — SteamID listesiyle yönetim.
 *
 * Klan yöneticisi panele SteamID listesi yapıştırıyor. Liste elle
 * derlendiği için kirli geliyor: profil bağlantıları, virgüller, satır
 * sonları, tekrarlar ve yanlış yazılmış kimlikler. Ayrıştırma bunu
 * bilerek toleranslı yapıyor ama GEÇERSİZ kimlikleri sessizce yutmuyor —
 * çağıran taraf hangilerinin alınmadığını görüyor, yoksa listenin yarısı
 * eksik girip kimse fark etmiyor.
 */

/** 17 haneli Steam64 kimliği. */
const STEAM64 = /^7656119\d{10}$/;

export interface AyristirmaSonucu {
  gecerli: string[];
  gecersiz: string[];
}

/**
 * Serbest metinden SteamID'leri çıkarır.
 *
 * Kabul edilen ayraçlar: satır sonu, virgül, noktalı virgül, boşluk.
 * Steam profil bağlantısındaki kimlik de yakalanıyor: yöneticiler
 * genellikle profil URL'si kopyalıyor.
 */
export function steamIdAyristir(ham: string): AyristirmaSonucu {
  const parcalar = ham
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean)
    // URL'den son sayı bloğunu al: .../profiles/7656119... biçimi.
    .map((p) => {
      const m = p.match(/(7656119\d{10})/);
      return m?.[1] ?? p;
    });

  const gecerli: string[] = [];
  const gecersiz: string[] = [];
  const gorulen = new Set<string>();

  for (const p of parcalar) {
    if (!STEAM64.test(p)) {
      gecersiz.push(p);
      continue;
    }
    // Tekrarlar sessizce teke indiriliyor: aynı kimliği iki kez
    // yapıştırmak bir hata değil, listeyi elle derlemenin doğal sonucu.
    if (gorulen.has(p)) continue;
    gorulen.add(p);
    gecerli.push(p);
  }

  return { gecerli, gecersiz };
}

export interface UyeEklemeSonucu {
  eklenen: number;
  zatenUye: number;
  olusturulanOyuncu: number;
  gecersiz: string[];
}

/**
 * SteamID listesini klana ekler.
 *
 * Veritabanında OLMAYAN oyuncu için kayıt açılıyor. Sebep: klan listesi
 * genellikle sunucuya hiç girmemiş yeni üyeleri de içeriyor ve onları
 * atlamak, üye ilk kez bağlandığında klansız görünmesi demekti — tam da
 * takım dengeleyicinin ona ihtiyaç duyduğu anda.
 */
export async function uyeEkle(db: Db, clanId: string, ham: string): Promise<UyeEklemeSonucu> {
  const { gecerli, gecersiz } = steamIdAyristir(ham);
  if (gecerli.length === 0) return { eklenen: 0, zatenUye: 0, olusturulanOyuncu: 0, gecersiz };

  const mevcutOyuncular = await db
    .select({ id: identitySchema.players.id, steamId: identitySchema.players.steamId })
    .from(identitySchema.players)
    .where(inArray(identitySchema.players.steamId, gecerli));

  const idyeGore = new Map(mevcutOyuncular.map((p) => [p.steamId as string, p.id]));

  let olusturulan = 0;
  const eksikler = gecerli.filter((s) => !idyeGore.has(s));
  if (eksikler.length > 0) {
    const yeniler = await db
      .insert(identitySchema.players)
      .values(eksikler.map((steamId) => ({ steamId })))
      .onConflictDoNothing()
      .returning({ id: identitySchema.players.id, steamId: identitySchema.players.steamId });
    for (const y of yeniler) {
      if (y.steamId) idyeGore.set(y.steamId, y.id);
    }
    olusturulan = yeniler.length;
  }

  const playerIds = gecerli.map((s) => idyeGore.get(s)).filter((v): v is string => Boolean(v));
  if (playerIds.length === 0) {
    return { eklenen: 0, zatenUye: 0, olusturulanOyuncu: olusturulan, gecersiz };
  }

  const zaten = await db
    .select({ playerId: identitySchema.clanMembers.playerId })
    .from(identitySchema.clanMembers)
    .where(
      and(
        eq(identitySchema.clanMembers.clanId, clanId),
        isNull(identitySchema.clanMembers.removedAt),
        inArray(identitySchema.clanMembers.playerId, playerIds),
      ),
    );
  const zatenSet = new Set(zaten.map((z) => z.playerId));

  const eklenecek = playerIds.filter((id) => !zatenSet.has(id));
  if (eklenecek.length > 0) {
    await db
      .insert(identitySchema.clanMembers)
      .values(eklenecek.map((playerId) => ({ clanId, playerId })))
      // Kısmi tekil indeks (clan_members_aktif_idx) aynı anda gelen iki
      // isteğin ikisini de yazmasını engelliyor; burası o çakışmayı hataya
      // dönüştürmüyor.
      .onConflictDoNothing();
  }

  return {
    eklenen: eklenecek.length,
    zatenUye: zatenSet.size,
    olusturulanOyuncu: olusturulan,
    gecersiz,
  };
}

/** Üyeliği kaldırır (silmez, işaretler). Kaldırılan sayısını döner. */
export async function uyeCikar(db: Db, clanId: string, ham: string): Promise<number> {
  const { gecerli } = steamIdAyristir(ham);
  if (gecerli.length === 0) return 0;

  const oyuncular = await db
    .select({ id: identitySchema.players.id })
    .from(identitySchema.players)
    .where(inArray(identitySchema.players.steamId, gecerli));
  if (oyuncular.length === 0) return 0;

  const sonuc = await db
    .update(identitySchema.clanMembers)
    .set({ removedAt: new Date() })
    .where(
      and(
        eq(identitySchema.clanMembers.clanId, clanId),
        isNull(identitySchema.clanMembers.removedAt),
        inArray(
          identitySchema.clanMembers.playerId,
          oyuncular.map((o) => o.id),
        ),
      ),
    )
    .returning({ id: identitySchema.clanMembers.id });

  return sonuc.length;
}
