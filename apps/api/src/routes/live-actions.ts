import type { Db } from '@altai/db';
import { identitySchema, moderationSchema, presenceSchema } from '@altai/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { agentBagliMi, komutGonder } from '../lib/agent-command-bus.js';
import { writeAudit } from '../lib/audit.js';
import { requireSession } from '../lib/auth-guard.js';
import { panelKomutuIsaretle } from '../lib/panel-komut-izi.js';
import { getServerState, oyuncuAdi } from '../lib/server-state.js';
import {
  type Hedef,
  bekleyenler,
  iptalEt,
  macSonunaErtele,
  simdiDegistir,
} from '../lib/team-change.js';

/**
 * Canlı ekrandan hızlı eylemler.
 *
 * Kontrol panelinde elimizde oyuncunun SteamID'si var, veritabanı UUID'si
 * değil — oyuncu listesi RCON'dan geliyor ve orada bizim kimliğimiz yok.
 * Moderasyon uçları ise UUID istiyor. Buradaki uçlar SteamID ile çalışıyor
 * ve UUID'yi kendileri çözüyor.
 *
 * Oyuncu veritabanında YOKSA eylem yine yapılıyor: RCON kimliği tanıyor,
 * bizim onu daha önce görmüş olmamız şart değil. Bu durumda denetim kaydı
 * hedefsiz yazılıyor ve SteamID yükte duruyor.
 */

const Govde = z.object({
  steamId: z.string().regex(/^7656119\d{10}$/, 'geçerli bir SteamID64 olmalı'),
  /** Kick sebebi ya da uyarı metni; oyuncuya gösteriliyor. */
  mesaj: z.string().trim().min(1).max(300),
});

function ilkHata(err: z.ZodError): string {
  const i = err.issues[0];
  if (!i) return 'geçersiz girdi';
  return i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message;
}

const TakimGovdesi = z.object({
  /** Bir oyuncu ya da bir manganın tamamı; ekran ikisini de gönderiyor. */
  steamIds: z
    .array(z.string().regex(/^7656119\d{10}$/))
    .min(1)
    .max(50),
  zaman: z.enum(['simdi', 'mac_sonu']),
  /**
   * Oyuncuların VARMASI istenen takım. "Karşıya çevir" değil "şurada
   * olsun": iki taraftan seçilenleri tek takımda toplamayı mümkün kılıyor
   * ve aynı isteği iki kez göndermeyi zararsız hâle getiriyor.
   */
  hedefTakim: z.union([z.literal(1), z.literal(2)]),
  /** Yetkilinin eklediği açıklama; oyuncuya gösterilen uyarıya ekleniyor. */
  mesaj: z.string().trim().max(200).optional(),
});

export async function liveActionRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  async function sunucuIdBul(slug: string) {
    const [s] = await db
      .select({ id: presenceSchema.servers.id })
      .from(presenceSchema.servers)
      .where(eq(presenceSchema.servers.slug, slug))
      .limit(1);
    return s?.id ?? null;
  }

  async function oyuncuBul(steamId: string) {
    const [p] = await db
      .select({ id: identitySchema.players.id, eosId: identitySchema.players.eosId })
      .from(identitySchema.players)
      .where(eq(identitySchema.players.steamId, steamId))
      .limit(1);
    return p ?? null;
  }

  /** Sunucudan at. Kalıcı kayıt bırakmaz — ban ayrı bir eylem. */
  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/live/:slug/kick',
    { preHandler: requireSession(db, 'player.kick') },
    async (req, reply) => {
      const parsed = Govde.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'gecersiz_girdi', detay: ilkHata(parsed.error) });
      }
      const slug = req.params.slug;
      if (!agentBagliMi(slug)) return reply.code(503).send({ error: 'agent_bagli_degil' });

      const oyuncu = await oyuncuBul(parsed.data.steamId);
      const actor = req.authSession;

      // Oyun bu komutu sohbet kanalından geri yayınlıyor; iz bırakmazsak
      // aynı işlem günlüğe iki kez düşerdi (bkz. panel-komut-izi.ts).
      panelKomutuIsaretle(slug, 'kick', oyuncuAdi(slug, parsed.data.steamId));

      const sonuc = await komutGonder(
        slug,
        'kick',
        { steamId: parsed.data.steamId, eosId: oyuncu?.eosId ?? null, reason: parsed.data.mesaj },
        actor?.id ?? 'panel',
      );

      await db.transaction(async (tx) => {
        await writeAudit(tx, {
          actorUserId: actor?.id ?? null,
          actorLabel: actor?.discordUsername ?? null,
          requestId: String(req.id),
          action: 'player.kick',
          targetType: 'player',
          targetId: oyuncu?.id ?? null,
          payload: {
            steamId: parsed.data.steamId,
            sebep: parsed.data.mesaj,
            sunucu: slug,
            sonuc: sonuc.durum,
          },
        });
      });

      if (sonuc.durum !== 'ok') {
        return reply.code(502).send({ error: 'komut_basarisiz', detay: sonuc.durum });
      }
      return { ok: true };
    },
  );

  /**
   * Zorla takım değiştirme — tek oyuncu ya da manganın tamamı.
   *
   * Hedefler SteamID listesiyle geliyor; takım ve isim canlı durumdan
   * okunuyor çünkü komutun doğruluğu oyuncunun O ANKİ takımına bağlı
   * (bkz. lib/team-change.ts: komut hedef takım almıyor).
   */
  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/live/:slug/takim',
    { preHandler: requireSession(db, 'player.team_change') },
    async (req, reply) => {
      const parsed = TakimGovdesi.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'gecersiz_girdi', detay: ilkHata(parsed.error) });
      }
      const slug = req.params.slug;
      if (!agentBagliMi(slug)) return reply.code(503).send({ error: 'agent_bagli_degil' });

      const durum = getServerState(slug);
      const actor = req.authSession;
      const aktor = { userId: actor?.id ?? null, name: actor?.discordUsername ?? null };

      const hedefler: Hedef[] = [];
      for (const steamId of parsed.data.steamIds) {
        const canli = durum?.players.find((p) => p.steamId === steamId);
        const oyuncu = await oyuncuBul(steamId);
        hedefler.push({
          steamId,
          eosId: canli?.eosId ?? oyuncu?.eosId ?? null,
          name: canli?.name ?? null,
          teamId: canli?.teamId ?? null,
          playerId: oyuncu?.id ?? null,
        });
      }

      if (parsed.data.zaman === 'simdi') {
        const sonuclar = await simdiDegistir(
          slug,
          hedefler,
          parsed.data.hedefTakim,
          parsed.data.mesaj,
          aktor,
        );
        const basarisiz = sonuclar.filter((s) => s.durum === 'komut_basarisiz').length;
        const dogrulanamayan = sonuclar.filter((s) => s.durum === 'dogrulanamadi').length;
        const zatenHedefte = sonuclar.filter((s) => s.durum === 'zaten_hedefte').length;
        // Kısmi başarı gizlenmiyor: dokuz kişilik mangada ikisi geçmediyse
        // yetkilinin bunu bilmesi gerekiyor. `dogrulanamayan` ayrı: komut
        // gitti ama Squad taşımadı — sebebi ve söylenecek şey farklı.
        return {
          ok: basarisiz === 0 && dogrulanamayan === 0,
          sonuclar,
          basarisiz,
          dogrulanamayan,
          zatenHedefte,
        };
      }

      const serverId = await sunucuIdBul(slug);
      if (!serverId) return reply.code(404).send({ error: 'sunucu_bulunamadi' });
      const sonuclar = await macSonunaErtele(
        db,
        slug,
        serverId,
        hedefler,
        parsed.data.hedefTakim,
        parsed.data.mesaj,
        aktor,
      );
      return { ok: true, sonuclar };
    },
  );

  /** Maç sonuna ertelenmiş, henüz uygulanmamış değişimler. */
  app.get<{ Params: { slug: string } }>(
    '/live/:slug/takim/bekleyen',
    { preHandler: requireSession(db, 'player.team_change') },
    async (req, reply) => {
      const serverId = await sunucuIdBul(req.params.slug);
      if (!serverId) return reply.code(404).send({ error: 'sunucu_bulunamadi' });
      return { bekleyenler: await bekleyenler(db, serverId) };
    },
  );

  /** Bekleyen bir değişimi iptal et. */
  app.post<{ Params: { slug: string; id: string } }>(
    '/live/:slug/takim/:id/iptal',
    { preHandler: requireSession(db, 'player.team_change') },
    async (req, reply) => {
      const actor = req.authSession;
      const oldu = await iptalEt(db, req.params.id, {
        userId: actor?.id ?? null,
        name: actor?.discordUsername ?? null,
      });
      if (!oldu) return reply.code(404).send({ error: 'kayit_yok_ya_da_islenmis' });
      return { ok: true };
    },
  );

  /** Oyun içinde uyarı göster. Kalıcı kayıt da bırakır (oyuncu biliniyorsa). */
  app.post<{ Params: { slug: string }; Body: unknown }>(
    '/live/:slug/warn',
    { preHandler: requireSession(db, 'player.warn') },
    async (req, reply) => {
      const parsed = Govde.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'gecersiz_girdi', detay: ilkHata(parsed.error) });
      }
      const slug = req.params.slug;
      if (!agentBagliMi(slug)) return reply.code(503).send({ error: 'agent_bagli_degil' });

      const oyuncu = await oyuncuBul(parsed.data.steamId);
      const actor = req.authSession;

      panelKomutuIsaretle(slug, 'warn', oyuncuAdi(slug, parsed.data.steamId));

      const sonuc = await komutGonder(
        slug,
        'warn',
        { steamId: parsed.data.steamId, eosId: oyuncu?.eosId ?? null, message: parsed.data.mesaj },
        actor?.id ?? 'panel',
      );

      await db.transaction(async (tx) => {
        // Uyarı kalıcı kayıt: profilde görünmeli, yoksa "bu adama daha önce
        // söylendi mi" sorusu cevapsız kalıyor.
        if (oyuncu) {
          await tx.insert(moderationSchema.playerRecords).values({
            playerId: oyuncu.id,
            kind: 'warning',
            body: parsed.data.mesaj,
            deliveredAt: sonuc.durum === 'ok' ? new Date() : null,
            authorUserId: actor?.id ?? null,
            authorName: actor?.discordUsername ?? null,
            source: 'altai',
          });
        }
        await writeAudit(tx, {
          actorUserId: actor?.id ?? null,
          actorLabel: actor?.discordUsername ?? null,
          requestId: String(req.id),
          action: 'player.warn',
          targetType: 'player',
          targetId: oyuncu?.id ?? null,
          payload: {
            steamId: parsed.data.steamId,
            mesaj: parsed.data.mesaj,
            sunucu: slug,
            sonuc: sonuc.durum,
          },
        });
      });

      if (sonuc.durum !== 'ok') {
        return reply.code(502).send({ error: 'komut_basarisiz', detay: sonuc.durum });
      }
      return { ok: true, kayit: Boolean(oyuncu) };
    },
  );
}
