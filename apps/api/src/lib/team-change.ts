import type { Db } from '@altai/db';
import { teamChangeSchema } from '@altai/db';
import { logger } from '@altai/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { kaydet } from './activity-log.js';
import { komutGonder } from './agent-command-bus.js';
import { panelKomutuIsaretle } from './panel-komut-izi.js';
import { sunucuyuTazele, tazelemeyiPlanla } from './player-refresh.js';
import { applyTeamChange, getServerState } from './server-state.js';

/**
 * Zorla takım değiştirme.
 *
 * Squad'ın komutu `AdminForceTeamChange <id>` ve HEDEF TAKIM ALMIYOR:
 * oyuncuyu karşı tarafa geçiriyor, o kadar. "1'e al" diye bir şey yok.
 * Bunun iki sonucu var:
 *
 *  1. Komutu iki kez göndermek oyuncuyu başladığı yere geri getirir —
 *     yani tekrar denemek zararsız DEĞİL.
 *  2. Maç sonuna ertelenen bir değişimde, oyuncu bu arada kendi geçtiyse
 *     komutu çalıştırmak onu geri alır. Bu yüzden kuyrukta oyuncunun
 *     istek anındaki takımı saklanıyor ve çalıştırmadan önce hâlâ orada
 *     mı diye bakılıyor.
 */

export type Zaman = 'simdi' | 'mac_sonu';

export interface Hedef {
  steamId: string;
  eosId?: string | null;
  /** Oyun içi adı — günlükte ve uyarı metninde kullanılıyor. */
  name?: string | null;
  /** İstek anındaki takımı. */
  teamId?: number | null;
  /** Bizim kaydımızdaki UUID; oyuncu veritabanında yoksa null. */
  playerId?: string | null;
}

export interface Aktor {
  userId: string | null;
  name: string | null;
}

export interface Sonuc {
  steamId: string;
  name: string | null;
  durum: 'ok' | 'kuyruga_alindi' | 'komut_basarisiz';
}

/** Oyuncuya gösterilecek metin. Yetkilinin kendi mesajı varsa ona eklenir. */
function uyariMetni(zaman: Zaman, mesaj: string | undefined): string {
  const temel =
    zaman === 'simdi'
      ? 'Bir yetkili sizi karşı takıma aldı.'
      : 'Maç sonunda karşı takıma alınacaksınız.';
  return mesaj ? `${temel} ${mesaj}` : temel;
}

/**
 * Uyarıyı gönderir. Başarısızlığı YUTUYOR: uyarı gitmedi diye takım
 * değişimini iptal etmek, yetkilinin verdiği kararı teknik bir aksaklığa
 * feda etmek olurdu.
 */
async function uyar(slug: string, hedef: Hedef, metin: string, issuedBy: string) {
  // Bu uyarı da oyundan yankı olarak geri geliyor ve iz bırakılmazsa
  // "yetkili oyuncuyu uyardı" diye ikinci kez günlüğe düşüyor. Canlıda
  // görüldü: "Bir yetkili sizi karşı takıma aldı." metni ingame.warn
  // olarak 6 kez kayıtlıydı.
  panelKomutuIsaretle(slug, 'warn', hedef.name ?? null);
  const sonuc = await komutGonder(
    slug,
    'warn',
    { steamId: hedef.steamId, eosId: hedef.eosId ?? null, message: metin },
    issuedBy,
  );
  if (sonuc.durum !== 'ok') {
    logger.warn({ slug, steamId: hedef.steamId, sonuc }, 'takım değişimi uyarısı gitmedi');
  }
}

/** Hemen geçir. Önce uyarı, sonra komut — oyuncu neden geçtiğini bilsin. */
export async function simdiDegistir(
  slug: string,
  hedefler: Hedef[],
  mesaj: string | undefined,
  actor: Aktor,
): Promise<Sonuc[]> {
  const issuedBy = actor.userId ?? 'panel';
  const metin = uyariMetni('simdi', mesaj);
  const sonuclar: Sonuc[] = [];
  const gecenler: string[] = [];

  // Sırayla: RCON zaten tek kanal, paralel göndermek sıraya girmekten
  // hızlı değil ama hata ayıklamayı zorlaştırırdı.
  for (const h of hedefler) {
    await uyar(slug, h, metin, issuedBy);
    const sonuc = await komutGonder(
      slug,
      'forceTeamChange',
      { steamId: h.steamId, eosId: h.eosId ?? null },
      issuedBy,
    );
    const ok = sonuc.durum === 'ok';
    if (ok) gecenler.push(h.steamId);
    sonuclar.push({
      steamId: h.steamId,
      name: h.name ?? null,
      durum: ok ? 'ok' : 'komut_basarisiz',
    });

    kaydet({
      actorType: actor.userId ? 'user' : 'system',
      actorUserId: actor.userId,
      actorLabel: actor.name,
      action: 'team_change.now',
      category: 'moderasyon',
      targetType: 'player',
      targetId: h.playerId ?? null,
      targetLabel: h.name ?? h.steamId,
      payload: {
        sunucu: slug,
        steamId: h.steamId,
        onceki_takim: h.teamId ?? null,
        ...(mesaj ? { mesaj } : {}),
        sonuc: sonuc.durum,
      },
    });
  }

  // Ekran ANINDA doğruyu göstersin: RCON tazelemesi 20 saniyede bir
  // çalışıyor ve o süre boyunca oyuncu eski takımında görünüyordu —
  // yetkili komutun çalışmadığını sanıyordu.
  if (gecenler.length > 0) {
    applyTeamChange(slug, gecenler);
    // İyimser güncelleme tahmin; doğrunun kaynağı hâlâ RCON. Kısa bir
    // gecikmeyle listeyi baştan okuyup teyit ediyoruz.
    tazelemeyiPlanla(slug);
  }

  return sonuclar;
}

/**
 * Maç sonuna ertele. Oyuncu ŞİMDİ uyarılıyor — istenen davranış tam da
 * bu: haberi olsun, maçın ortasında sürprizle karşılaşmasın.
 */
export async function macSonunaErtele(
  db: Db,
  slug: string,
  serverId: string,
  hedefler: Hedef[],
  mesaj: string | undefined,
  actor: Aktor,
): Promise<Sonuc[]> {
  const issuedBy = actor.userId ?? 'panel';
  const metin = uyariMetni('mac_sonu', mesaj);

  // Aynı oyuncu için ikinci bir bekleyen kayıt açılmıyor: maç sonunda iki
  // kez çevirmek oyuncuyu başladığı yere geri getirirdi (komut hedef takım
  // almıyor, sadece "diğer tarafa geç" diyor).
  const zatenBekleyen = await db
    .select({ steamId: teamChangeSchema.teamChangeQueue.steamId })
    .from(teamChangeSchema.teamChangeQueue)
    .where(
      and(
        eq(teamChangeSchema.teamChangeQueue.serverId, serverId),
        isNull(teamChangeSchema.teamChangeQueue.settledAt),
        inArray(
          teamChangeSchema.teamChangeQueue.steamId,
          hedefler.map((h) => h.steamId),
        ),
      ),
    );
  const bekleyenKume = new Set(zatenBekleyen.map((r) => r.steamId));
  const yeniler = hedefler.filter((h) => !bekleyenKume.has(h.steamId));
  if (yeniler.length === 0) {
    return hedefler.map((h) => ({
      steamId: h.steamId,
      name: h.name ?? null,
      durum: 'kuyruga_alindi' as const,
    }));
  }

  await db.insert(teamChangeSchema.teamChangeQueue).values(
    yeniler.map((h) => ({
      serverId,
      playerId: h.playerId ?? null,
      steamId: h.steamId,
      playerName: h.name ?? null,
      fromTeam: h.teamId === null || h.teamId === undefined ? null : String(h.teamId),
      requestedByUserId: actor.userId,
      requestedByName: actor.name,
      message: mesaj ?? null,
    })),
  );

  for (const h of yeniler) {
    await uyar(slug, h, metin, issuedBy);
    kaydet({
      actorType: actor.userId ? 'user' : 'system',
      actorUserId: actor.userId,
      actorLabel: actor.name,
      action: 'team_change.scheduled',
      category: 'moderasyon',
      targetType: 'player',
      targetId: h.playerId ?? null,
      targetLabel: h.name ?? h.steamId,
      payload: {
        sunucu: slug,
        steamId: h.steamId,
        onceki_takim: h.teamId ?? null,
        ...(mesaj ? { mesaj } : {}),
      },
    });
  }

  return hedefler.map((h) => ({
    steamId: h.steamId,
    name: h.name ?? null,
    durum: 'kuyruga_alindi' as const,
  }));
}

/** Bir sunucuda bekleyen değişimler — panelde göstermek için. */
export async function bekleyenler(db: Db, serverId: string) {
  return db
    .select({
      id: teamChangeSchema.teamChangeQueue.id,
      steamId: teamChangeSchema.teamChangeQueue.steamId,
      playerName: teamChangeSchema.teamChangeQueue.playerName,
      fromTeam: teamChangeSchema.teamChangeQueue.fromTeam,
      requestedByName: teamChangeSchema.teamChangeQueue.requestedByName,
      createdAt: teamChangeSchema.teamChangeQueue.createdAt,
    })
    .from(teamChangeSchema.teamChangeQueue)
    .where(
      and(
        eq(teamChangeSchema.teamChangeQueue.serverId, serverId),
        isNull(teamChangeSchema.teamChangeQueue.settledAt),
      ),
    );
}

/** Bekleyen bir değişimi iptal eder. */
export async function iptalEt(db: Db, id: string, actor: Aktor): Promise<boolean> {
  const [row] = await db
    .update(teamChangeSchema.teamChangeQueue)
    .set({ settledAt: new Date(), result: 'iptal' })
    .where(
      and(
        eq(teamChangeSchema.teamChangeQueue.id, id),
        isNull(teamChangeSchema.teamChangeQueue.settledAt),
      ),
    )
    .returning({ steamId: teamChangeSchema.teamChangeQueue.steamId });
  if (!row) return false;

  kaydet({
    actorType: actor.userId ? 'user' : 'system',
    actorUserId: actor.userId,
    actorLabel: actor.name,
    action: 'team_change.cancel',
    category: 'moderasyon',
    targetType: 'player',
    targetLabel: row.steamId,
    payload: { kuyrukId: id },
  });
  return true;
}

/**
 * Maç sonunda bekleyen bir kayıt için ne yapılacağı.
 *
 * Ayrı ve saf: buradaki hata sessiz olurdu — yanlış karar oyuncuyu
 * yanlış takıma atar ve kimse bunu bir hata olarak görmez, "panel
 * saçmaladı" diye geçilir.
 */
export function degisimKarari(
  fromTeam: string | null,
  oyuncu: { teamId: number | null } | undefined,
): 'oyuncu_yok' | 'zaten_karsida' | 'uygula' {
  if (!oyuncu) return 'oyuncu_yok';
  // Takımı bilmiyorsak uyguluyoruz: kaydı yetkili bilerek açtı, kararı
  // eksik bilgi yüzünden düşürmek sözü tutmamak olurdu.
  if (fromTeam === null || oyuncu.teamId === null) return 'uygula';
  return String(oyuncu.teamId) === fromTeam ? 'uygula' : 'zaten_karsida';
}

/**
 * Maç bittiğinde çağrılır: bekleyen değişimleri uygular.
 *
 * Üç durumu ayırıyor ve üçü de kuyrukta işaretleniyor — "maç sonunda
 * geçirilecekti, ne oldu" sorusunun cevabı kaybolmamalı:
 *   oyuncu_yok      -> maç bitmeden çıkmış
 *   zaten_karsida   -> bu arada zaten geçmiş, komut onu GERİ getirirdi
 *   komut_basarisiz -> RCON yanıt vermedi
 */
export async function macSonuIsle(db: Db, slug: string, serverId: string): Promise<number> {
  const kuyruk = await db
    .select()
    .from(teamChangeSchema.teamChangeQueue)
    .where(
      and(
        eq(teamChangeSchema.teamChangeQueue.serverId, serverId),
        isNull(teamChangeSchema.teamChangeQueue.settledAt),
      ),
    );
  if (kuyruk.length === 0) return 0;

  // Kararı BAYAT veriyle vermiyoruz. Canlı liste normalde 20 saniyede bir
  // tazeleniyor ve altındaki SquadJS önbelleği 10 saniyede bir; ikisi
  // üst üste binince maç sonunda elimizdeki takım bilgisi yarım dakika
  // eski olabiliyor. "Oyuncu bu arada zaten karşıya geçti mi" kontrolünün
  // bütün değeri güncel olmasında — eski veriyle bakarsak oyuncuyu tam
  // tersi yöne atarız.
  await sunucuyuTazele(slug, true).catch(() => {
    // Tazeleme başarısızsa elimizdeki listeyle devam ediyoruz: kararı
    // hiç uygulamamak, verilen sözü tutmamak olurdu.
  });

  const durum = getServerState(slug);
  let uygulanan = 0;

  for (const kayit of kuyruk) {
    const oyuncu = durum?.players.find((p) => p.steamId === kayit.steamId);
    const karar = degisimKarari(kayit.fromTeam, oyuncu);
    let sonuc: string;

    if (karar !== 'uygula') {
      sonuc = karar;
    } else {
      const komut = await komutGonder(
        slug,
        'forceTeamChange',
        // `karar === 'uygula'` oyuncunun bulunduğunu garanti ediyor ama
        // TypeScript bunu ayrı fonksiyondan çıkaramıyor; opsiyonel erişim
        // ile geçiyoruz.
        { steamId: kayit.steamId, eosId: oyuncu?.eosId ?? null },
        kayit.requestedByUserId ?? 'panel',
      );
      sonuc = komut.durum === 'ok' ? 'ok' : 'komut_basarisiz';
      if (komut.durum === 'ok') {
        uygulanan += 1;
        applyTeamChange(slug, [kayit.steamId]);
      }
    }

    await db
      .update(teamChangeSchema.teamChangeQueue)
      .set({ settledAt: new Date(), result: sonuc })
      .where(eq(teamChangeSchema.teamChangeQueue.id, kayit.id));

    kaydet({
      actorType: 'system',
      actorLabel: 'mac-sonu',
      action: 'team_change.executed',
      category: 'moderasyon',
      targetType: 'player',
      targetId: kayit.playerId,
      targetLabel: kayit.playerName ?? kayit.steamId,
      payload: {
        sunucu: slug,
        steamId: kayit.steamId,
        isteyen: kayit.requestedByName,
        sonuc,
      },
    });
  }

  if (uygulanan > 0) tazelemeyiPlanla(slug);
  logger.info({ slug, kuyruk: kuyruk.length, uygulanan }, 'maç sonu takım değişimleri işlendi');
  return uygulanan;
}
