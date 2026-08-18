import type { Db } from '@altai/db';
import { accessSchema, identitySchema } from '@altai/db';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Steam hesabı <-> Discord hesabı bağlama.
 *
 * Yetki zincirinin eksik halkası buydu: Discord rolü -> sistem rolü ->
 * Admins.cfg üretimi zinciri, oyuncunun hangi Steam hesabına ait olduğunu
 * bilmeden tamamlanamıyor. 550 whitelist kaydından yalnızca 97'sinin bağı
 * vardı ve gerisi elle giriliyordu.
 *
 * Bağlama Discord tarafından başlatılıyor: kişi kendi Discord hesabıyla
 * komutu yazıyor ve SteamID'sini veriyor. Tersi (panelden Discord'a) daha
 * zor: panele giren kişi zaten Discord ile giriş yapmış oluyor ama oyun
 * hesabını doğrulayacak bir şey yok.
 *
 * DOĞRULAMA YOK ve bu bilinçli bir sınır: kişi başkasının SteamID'sini
 * yazabilir. Buradaki güvence sosyal — komut Discord sunucusunda, kimliği
 * belli bir hesapla çalışıyor ve bağ `linked_at` ile kayda geçiyor, yani
 * yanlış bağ sonradan görülebiliyor. Gerçek doğrulama (oyun içi kod)
 * ayrı bir iş ve şimdilik kapsam dışı.
 */

const STEAM64 = /^7656119\d{10}$/;

export type BaglamaSonucu =
  | { durum: 'baglandi'; playerId: string }
  | { durum: 'zaten_bagli'; steamId: string }
  | { durum: 'steam_baskasinda' }
  | { durum: 'gecersiz_steamid' };

/** Serbest metinden SteamID çıkarır (profil bağlantısı da kabul). */
export function steamIdOku(ham: string): string | null {
  const m = ham.trim().match(/(7656119\d{10})/);
  const aday = m?.[1] ?? ham.trim();
  return STEAM64.test(aday) ? aday : null;
}

/**
 * Discord hesabını Steam hesabına bağlar.
 *
 * Aynı Discord hesabının İKİNCİ bir bağ kurması engelleniyor: `discordId`
 * tekil ve bir kişinin iki oyun hesabı olması, yetki zincirinde hangisinin
 * geçerli olduğunu belirsizleştirir. Değiştirmek isteyen önce mevcut bağı
 * kaldırmalı.
 */
export async function hesapBagla(
  db: Db,
  discordId: string,
  hamSteamId: string,
): Promise<BaglamaSonucu> {
  const steamId = steamIdOku(hamSteamId);
  if (!steamId) return { durum: 'gecersiz_steamid' };

  const [mevcut] = await db
    .select({ playerId: accessSchema.discordLinks.playerId })
    .from(accessSchema.discordLinks)
    .where(
      and(
        eq(accessSchema.discordLinks.discordId, discordId),
        isNull(accessSchema.discordLinks.unlinkedAt),
      ),
    )
    .limit(1);

  if (mevcut) {
    const [oyuncu] = await db
      .select({ steamId: identitySchema.players.steamId })
      .from(identitySchema.players)
      .where(eq(identitySchema.players.id, mevcut.playerId))
      .limit(1);
    return { durum: 'zaten_bagli', steamId: oyuncu?.steamId ?? '(bilinmiyor)' };
  }

  // Oyuncu kaydı yoksa açılıyor: klan listelerinde olduğu gibi, henüz
  // sunucuya girmemiş biri de hesabını önceden bağlayabilmeli.
  let [oyuncu] = await db
    .select({ id: identitySchema.players.id })
    .from(identitySchema.players)
    .where(eq(identitySchema.players.steamId, steamId))
    .limit(1);

  if (!oyuncu) {
    const [olusan] = await db
      .insert(identitySchema.players)
      .values({ steamId })
      .onConflictDoNothing()
      .returning({ id: identitySchema.players.id });
    oyuncu = olusan;
  }
  if (!oyuncu) return { durum: 'gecersiz_steamid' };

  // Bu Steam hesabı BAŞKA bir Discord hesabına bağlıysa reddediliyor.
  // İki kişinin aynı oyun hesabına bağlanması, yetkinin kime ait olduğunu
  // belirsizleştirir ve bir hesabın yetkisini başkasına taşıyabilirdi.
  const [baskasinda] = await db
    .select({ discordId: accessSchema.discordLinks.discordId })
    .from(accessSchema.discordLinks)
    .where(
      and(
        eq(accessSchema.discordLinks.playerId, oyuncu.id),
        isNull(accessSchema.discordLinks.unlinkedAt),
      ),
    )
    .limit(1);
  if (baskasinda && baskasinda.discordId !== discordId) return { durum: 'steam_baskasinda' };

  await db
    .insert(accessSchema.discordLinks)
    .values({ discordId, playerId: oyuncu.id })
    .onConflictDoNothing();

  return { durum: 'baglandi', playerId: oyuncu.id };
}

/** Bağı kaldırır (silmez, işaretler). Kaldırıldıysa `true`. */
export async function hesapCoz(db: Db, discordId: string): Promise<boolean> {
  const sonuc = await db
    .update(accessSchema.discordLinks)
    .set({ unlinkedAt: new Date() })
    .where(
      and(
        eq(accessSchema.discordLinks.discordId, discordId),
        isNull(accessSchema.discordLinks.unlinkedAt),
      ),
    )
    .returning({ id: accessSchema.discordLinks.id });
  return sonuc.length > 0;
}
