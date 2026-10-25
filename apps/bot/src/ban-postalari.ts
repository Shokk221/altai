import type { Db } from '@altai/db';
import { identitySchema, moderationSchema } from '@altai/db';
import { logger } from '@altai/shared';
import { type ForumChannel, ThreadAutoArchiveDuration } from 'discord.js';
import { and, asc, desc, eq, gt, inArray, isNull } from 'drizzle-orm';

/**
 * Panelden atılan her ban için Discord forum kanalında bir gönderi açar.
 *
 * Yetkili kanıtı (klip, ekran görüntüsü) o gönderiye ekliyor. Eski sistem
 * de aynısını yapıyordu; panel banları o akıştan düşmemeli, yoksa iki
 * sistem arasında "bazı banların kanıtı var, bazılarının yok" boşluğu
 * oluşur.
 *
 * NEDEN BOT, api DEĞİL: Discord jetonu bot'ta ve orada kalmalı. api'ye
 * ikinci bir kopya koymak, ban atan bir ucu aynı zamanda Discord'a yazan
 * bir uç hâline getirirdi.
 *
 * NEDEN YOKLAMA, olay değil: ban bir agent olayı değil, panel eylemi;
 * `raw_events`'e düşmüyor. Bot zaten veritabanına bağlı (rol senkronu),
 * o sınır çoktan geçilmiş.
 *
 * İKİ KORUMA, çünkü yanlışı pahalı:
 *
 *   1. YALNIZCA `source='altai'`. Veritabanında BM'den aktarılmış 25.641
 *      ban var; süzgeç olmasa bot ilk turda hepsini Discord'a boşaltırdı.
 *   2. ZAMAN PENCERESİ. Süzgeç bir gün gevşerse ya da yeni bir aktarım
 *      `altai` kaynağıyla gelirse, pencere hasarı son saatlerle sınırlar.
 *
 * Tekrarı önleyen şey `discord_thread_id`: dolu olan kayıt bir daha
 * gönderilmiyor. Ayrı bir imleç tutulsaydı bot yeniden başladığında ya
 * aynı banı iki kez gönderir ya da hiç göndermezdi.
 */

export interface BanKaydi {
  id: string;
  tur: 'ban' | 'sl';
  oyuncuAdi: string | null;
  steamId: string | null;
  eosId: string | null;
  reason: string;
  expiresAt: Date | null;
  verenAd: string | null;
}

/** Discord thread adı 100 karakterle sınırlı. */
const BASLIK_SINIRI = 100;

/**
 * Gönderi başlığı — eski sistemin biçimine uyuyor:
 *   `Ban: Osmanweb-76561198873484318`
 *   `SL Ban: FHP_Reddeogon`
 *
 * Kimlik YOKSA hiç yazılmıyor. Eski sistem burada ham yer tutucu
 * basıyordu (kanalda `Ban: PZ Höllensturm-{{player.steamID}}` diye
 * duruyor); aynı hatayı tekrarlamıyoruz.
 */
export function gonderiBasligi(
  k: Pick<BanKaydi, 'tur' | 'oyuncuAdi' | 'steamId' | 'eosId'>,
): string {
  const on = k.tur === 'sl' ? 'SL Ban' : 'Ban';
  const ad = (k.oyuncuAdi ?? '').trim() || 'bilinmeyen oyuncu';
  const kimlik = k.steamId?.trim() || k.eosId?.trim() || null;
  const tam = kimlik ? `${on}: ${ad}-${kimlik}` : `${on}: ${ad}`;
  return tam.length > BASLIK_SINIRI ? `${tam.slice(0, BASLIK_SINIRI - 1)}…` : tam;
}

/** Gönderinin ilk mesajı. Kanıtı yetkili buraya ekliyor. */
export function gonderiGovdesi(k: BanKaydi, panelUrl: string | null): string {
  const satirlar: string[] = [];
  satirlar.push(
    k.tur === 'sl' ? '**SL ban** — oyuncu sunucuda kalır, manga lideri olamaz.' : '**Oyundan ban**',
  );
  satirlar.push(`**Sebep:** ${k.reason}`);
  const bitis = k.expiresAt
    ? `${k.expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : 'kalıcı';
  satirlar.push(`**Süre:** ${bitis}`);
  if (k.verenAd) satirlar.push(`**Atan:** ${k.verenAd}`);
  const kimlikler = [
    k.steamId ? `Steam ${k.steamId}` : null,
    k.eosId ? `EOS ${k.eosId}` : null,
  ].filter(Boolean);
  if (kimlikler.length > 0) satirlar.push(kimlikler.join(' · '));
  if (panelUrl) satirlar.push(panelUrl);
  satirlar.push('');
  satirlar.push('_Kanıtı (klip, ekran görüntüsü) bu gönderiye ekleyin._');
  return satirlar.join('\n');
}

export interface BanPostaSecenekleri {
  db: Db;
  /** Forum kanalını getirir. Bulunamazsa null — özellik sessizce boş geçer. */
  kanal: () => Promise<ForumChannel | null>;
  /** Oyuncu profiline bağlantı üretir. Verilmezse bağlantı yazılmıyor. */
  profilUrl?: (playerId: string) => string;
  aralikMs?: number;
  /** Bu kadar eskiye kadar olan kayıtlar gönderilir. */
  pencereDk?: number;
  /** Tek turda en fazla kaç gönderi. */
  turBasina?: number;
}

export interface BanPostalari {
  /** Bir tur çalıştırır. Testler bunu doğrudan çağırıyor. */
  tur(): Promise<number>;
  baslat(): void;
  durdur(): void;
}

/** Gönderilmeyi bekleyen panel banları (oyun banı + SL ban). */
export async function bekleyenler(
  db: Db,
  pencereDk: number,
  limit: number,
): Promise<(BanKaydi & { playerId: string })[]> {
  const esik = new Date(Date.now() - pencereDk * 60_000);

  const banlar = await db
    .select({
      id: moderationSchema.bans.id,
      playerId: moderationSchema.bans.playerId,
      steamId: identitySchema.players.steamId,
      eosId: identitySchema.players.eosId,
      reason: moderationSchema.bans.reason,
      expiresAt: moderationSchema.bans.expiresAt,
      verenAd: moderationSchema.bans.issuedByName,
    })
    .from(moderationSchema.bans)
    .innerJoin(
      identitySchema.players,
      eq(identitySchema.players.id, moderationSchema.bans.playerId),
    )
    .where(
      and(
        isNull(moderationSchema.bans.discordThreadId),
        eq(moderationSchema.bans.source, 'altai'),
        gt(moderationSchema.bans.createdAt, esik),
      ),
    )
    .orderBy(asc(moderationSchema.bans.createdAt))
    .limit(limit);

  const slBanlar = await db
    .select({
      id: moderationSchema.flagAssignments.id,
      playerId: moderationSchema.flagAssignments.playerId,
      steamId: identitySchema.players.steamId,
      eosId: identitySchema.players.eosId,
      reason: moderationSchema.flagAssignments.reason,
      expiresAt: moderationSchema.flagAssignments.expiresAt,
      verenAd: moderationSchema.flagAssignments.addedByName,
      etiketAdi: moderationSchema.flags.name,
    })
    .from(moderationSchema.flagAssignments)
    .innerJoin(
      identitySchema.players,
      eq(identitySchema.players.id, moderationSchema.flagAssignments.playerId),
    )
    .innerJoin(
      moderationSchema.flags,
      eq(moderationSchema.flags.id, moderationSchema.flagAssignments.flagId),
    )
    .where(
      and(
        isNull(moderationSchema.flagAssignments.discordThreadId),
        eq(moderationSchema.flagAssignments.source, 'altai'),
        gt(moderationSchema.flagAssignments.addedAt, esik),
      ),
    )
    .orderBy(asc(moderationSchema.flagAssignments.addedAt))
    .limit(limit);

  const hamKayitlar = [
    ...banlar.map((b) => ({ ...b, tur: 'ban' as const })),
    // Yalnızca SL ban etiketi. Ad eşleştirmesi SQL'de değil burada:
    // harf duyarsızlık Türkçe'ye özgü (İ/ı) ve collation'a bırakılamaz.
    ...slBanlar
      .filter((f) => f.etiketAdi.trim().toLocaleUpperCase('tr-TR') === 'SL BAN')
      // Gerekçe panelden zorunlu; eski bir satır boş olsa da gönderi
      // başlıksız kalmasın.
      .map((f) => ({ ...f, reason: f.reason ?? 'SL ban', tur: 'sl' as const })),
  ];
  if (hamKayitlar.length === 0) return [];

  // İsim `players`ta değil, `player_names` geçmişinde: güncel ad, en son
  // görülen satır (profil ekranı da aynı kuralı kullanıyor). Ayrı sorgu,
  // çünkü sayfa zaten en fazla birkaç kayıt ve lateral join'in karmaşası
  // bu boyutta kazanç getirmiyor.
  const idler = [...new Set(hamKayitlar.map((k) => k.playerId))];
  const isimSatirlari = await db
    .select({
      playerId: identitySchema.playerNames.playerId,
      name: identitySchema.playerNames.name,
      lastSeen: identitySchema.playerNames.lastSeen,
    })
    .from(identitySchema.playerNames)
    .where(inArray(identitySchema.playerNames.playerId, idler))
    .orderBy(desc(identitySchema.playerNames.lastSeen));

  const isimler = new Map<string, string>();
  for (const satir of isimSatirlari) {
    if (!isimler.has(satir.playerId)) isimler.set(satir.playerId, satir.name);
  }

  return hamKayitlar.map((k) => ({ ...k, oyuncuAdi: isimler.get(k.playerId) ?? null }));
}

export function createBanPostalari(opts: BanPostaSecenekleri): BanPostalari {
  const aralikMs = opts.aralikMs ?? 20_000;
  const pencereDk = opts.pencereDk ?? 120;
  const turBasina = opts.turBasina ?? 10;
  let zamanlayici: ReturnType<typeof setInterval> | undefined;
  let kosuyor = false;

  async function isaretle(kayit: BanKaydi, threadId: string) {
    if (kayit.tur === 'ban') {
      await opts.db
        .update(moderationSchema.bans)
        .set({ discordThreadId: threadId })
        .where(eq(moderationSchema.bans.id, kayit.id));
      return;
    }
    await opts.db
      .update(moderationSchema.flagAssignments)
      .set({ discordThreadId: threadId })
      .where(eq(moderationSchema.flagAssignments.id, kayit.id));
  }

  async function tur(): Promise<number> {
    const kanal = await opts.kanal();
    if (!kanal) return 0;

    const kayitlar = await bekleyenler(opts.db, pencereDk, turBasina);
    let acilan = 0;

    for (const kayit of kayitlar) {
      try {
        const thread = await kanal.threads.create({
          name: gonderiBasligi(kayit),
          autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
          message: {
            content: gonderiGovdesi(kayit, opts.profilUrl?.(kayit.playerId) ?? null),
          },
          reason: kayit.tur === 'sl' ? 'SL ban kanıt gönderisi' : 'Ban kanıt gönderisi',
        });
        // ÖNCE thread, SONRA işaret. Ters sırada, işaret yazılıp thread
        // açılamazsa ban sessizce kanalsız kalırdı.
        await isaretle(kayit, thread.id);
        acilan += 1;
      } catch (err) {
        // Tek bir gönderinin düşmesi turu durdurmuyor: kanal izni ya da
        // tek bir bozuk kayıt yüzünden sıradaki banların da kanıtsız
        // kalması, sorunun kendisinden pahalı.
        logger.error({ err, kayit: kayit.id, tur: kayit.tur }, 'ban gönderisi açılamadı');
      }
    }
    return acilan;
  }

  return {
    tur,
    baslat() {
      if (zamanlayici) return;
      zamanlayici = setInterval(() => {
        // Önceki tur bitmediyse üstüne binme: Discord hız sınırına
        // takılan bir tur uzayabiliyor.
        if (kosuyor) return;
        kosuyor = true;
        void tur()
          .catch((err) => logger.error({ err }, 'ban gönderisi turu düştü'))
          .finally(() => {
            kosuyor = false;
          });
      }, aralikMs);
    },
    durdur() {
      if (zamanlayici) clearInterval(zamanlayici);
      zamanlayici = undefined;
    },
  };
}
