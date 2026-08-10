import type { Db } from '@altai/db';
import { identitySchema, moderationSchema, presenceSchema } from '@altai/db';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { agentBagliMi, komutGonder } from '../lib/agent-command-bus.js';
import { writeAudit } from '../lib/audit.js';
import { requireSession } from '../lib/auth-guard.js';

/**
 * Moderasyon yazma uçları — plan Faz 2'nin çekirdeği.
 *
 * Üç kural bütün uçlarda geçerli:
 *
 *  1. Hiçbir şey silinmez. Ban kaldırma `revoked_at`, etiket kaldırma
 *     `removed_at`, kayıt kapatma `resolved_at` yazar. "Altı ay önce bu
 *     kişide ne vardı" sorusu her zaman cevaplanabilmeli.
 *  2. Her yazma, kendi transaction'ı içinde denetim kaydı bırakır.
 *  3. Girdi Zod ile doğrulanır ve doğrulama HATASI 400 döner — Fastify'ın
 *     ham şema hatası kullanıcıya sızmasın.
 */

const uuid = z.string().uuid();

const BanBody = z.object({
  reason: z.string().trim().min(3).max(500),
  /** null/yok = kalıcı. */
  expiresAt: z.string().datetime().nullish(),
  internalNote: z.string().trim().max(2000).nullish(),
  evidence: z.string().trim().max(1000).nullish(),
  /** null = tüm sunucular. */
  serverId: uuid.nullish(),
});

const RecordBody = z.object({
  kind: z.enum(moderationSchema.PLAYER_RECORD_KINDS),
  body: z.string().trim().min(1).max(4000),
  serverId: uuid.nullish(),
});

const FlagBody = z.object({ flagId: uuid });

/** Zod hatasını okunur tek satıra indirger. */
function ilkHata(err: z.ZodError): string {
  const i = err.issues[0];
  if (!i) return 'geçersiz girdi';
  return i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message;
}

export async function moderationRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  /** Oyuncunun var olduğunu doğrular; yoksa 404. */
  async function playerVarMi(playerId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: identitySchema.players.id })
      .from(identitySchema.players)
      .where(eq(identitySchema.players.id, playerId))
      .limit(1);
    return Boolean(row);
  }

  // ------------------------------------------------------------------ ban
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/players/:id/bans',
    { preHandler: requireSession(db, 'player.ban') },
    async (req, reply) => {
      const playerId = uuid.safeParse(req.params.id);
      if (!playerId.success) return reply.code(400).send({ error: 'gecersiz_oyuncu_id' });

      const parsed = BanBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'gecersiz_girdi', detay: ilkHata(parsed.error) });
      }
      if (!(await playerVarMi(playerId.data))) {
        return reply.code(404).send({ error: 'oyuncu_bulunamadi' });
      }

      const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
      // Geçmişe ban: kayıt anında süresi dolmuş olur, yani hiçbir şey yapmaz.
      // Sessizce kabul etmek "ban attım" sanmasına yol açar.
      if (expiresAt && expiresAt <= new Date()) {
        return reply.code(400).send({ error: 'bitis_gecmiste' });
      }

      const actor = req.authSession;
      const ban = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(moderationSchema.bans)
          .values({
            playerId: playerId.data,
            serverId: parsed.data.serverId ?? null,
            reason: parsed.data.reason,
            internalNote: parsed.data.internalNote ?? null,
            evidence: parsed.data.evidence ?? null,
            expiresAt,
            issuedByUserId: actor?.id ?? null,
            issuedByName: actor?.discordUsername ?? null,
            source: 'altai',
          })
          .returning();
        if (!created) throw new Error('ban eklenemedi');

        await writeAudit(tx, {
          actorUserId: actor?.id ?? null,
          action: 'ban.create',
          targetType: 'ban',
          targetId: created.id,
          payload: {
            playerId: playerId.data,
            reason: parsed.data.reason,
            expiresAt: expiresAt?.toISOString() ?? null,
          },
        });
        return created;
      });

      // Ban kaydedildi; şimdi oyuncuyu o anki maçtan çıkar. Bu EN İYİ ÇABA:
      // agent kopuksa ya da RCON yanıt vermiyorsa ban yine geçerli, oyuncu
      // bir sonraki girişinde remote ban list tarafından engellenir.
      // Bu yüzden sonucu 201'in içinde bildiriyoruz, hata olarak değil.
      const atma = await oyuncuyuAt(
        playerId.data,
        parsed.data.reason,
        actor?.id ?? 'sistem',
        parsed.data.serverId ?? null,
      );

      return reply.code(201).send({ ban, atma });
    },
  );

  /**
   * Oyuncuyu banın kapsadığı sunuculardan atar.
   *
   * Ban sunucuya özelse (serverId dolu) YALNIZCA o sunucudan atılır. Küresel
   * bansa hepsinden — hangi sunucuda olduğunu bilmiyoruz ve oyuncu orada
   * değilse RCON zararsız bir "bulunamadı" döner.
   *
   * Kapsamı yok saymak, turnuva sunucusundan yasaklanan birinin ana
   * sunucudaki maçından da atılması demekti.
   */
  async function oyuncuyuAt(
    playerId: string,
    reason: string,
    issuedBy: string,
    banServerId: string | null,
  ) {
    const [p] = await db
      .select({
        steamId: identitySchema.players.steamId,
        eosId: identitySchema.players.eosId,
      })
      .from(identitySchema.players)
      .where(eq(identitySchema.players.id, playerId))
      .limit(1);
    if (!p) return { denendi: false as const };

    const sunucular = await db
      .select({ id: presenceSchema.servers.id, slug: presenceSchema.servers.slug })
      .from(presenceSchema.servers);
    const kapsam = banServerId ? sunucular.filter((s) => s.id === banServerId) : sunucular;

    const sonuclar: Record<string, string> = {};
    for (const s of kapsam) {
      if (!agentBagliMi(s.slug)) {
        sonuclar[s.slug] = 'agent_yok';
        continue;
      }
      const sonuc = await komutGonder(
        s.slug,
        'kick',
        { steamId: p.steamId, eosId: p.eosId, reason },
        issuedBy,
      );
      sonuclar[s.slug] = sonuc.durum === 'hata' ? `hata: ${sonuc.mesaj}` : sonuc.durum;
    }
    return { denendi: true as const, sunucular: sonuclar };
  }

  app.post<{ Params: { id: string }; Body: unknown }>(
    '/bans/:id/revoke',
    { preHandler: requireSession(db, 'player.ban') },
    async (req, reply) => {
      const banId = uuid.safeParse(req.params.id);
      if (!banId.success) return reply.code(400).send({ error: 'gecersiz_ban_id' });

      const actor = req.authSession;
      const sonuc = await db.transaction(async (tx) => {
        // Zaten kaldırılmış banı ikinci kez kaldırmak revoked_at'i ve
        // "kim kaldırdı" bilgisini ezerdi — ilk kaldıran kaydı korunmalı.
        const [mevcut] = await tx
          .select({ id: moderationSchema.bans.id, revokedAt: moderationSchema.bans.revokedAt })
          .from(moderationSchema.bans)
          .where(eq(moderationSchema.bans.id, banId.data))
          .limit(1);
        if (!mevcut) return { durum: 'yok' as const };
        if (mevcut.revokedAt) return { durum: 'zaten_kaldirilmis' as const };

        const [guncel] = await tx
          .update(moderationSchema.bans)
          .set({ revokedAt: new Date(), revokedByUserId: actor?.id ?? null })
          .where(eq(moderationSchema.bans.id, banId.data))
          .returning();

        await writeAudit(tx, {
          actorUserId: actor?.id ?? null,
          action: 'ban.revoke',
          targetType: 'ban',
          targetId: banId.data,
        });
        return { durum: 'ok' as const, ban: guncel };
      });

      if (sonuc.durum === 'yok') return reply.code(404).send({ error: 'ban_bulunamadi' });
      if (sonuc.durum === 'zaten_kaldirilmis') {
        return reply.code(409).send({ error: 'ban_zaten_kaldirilmis' });
      }
      return { ban: sonuc.ban };
    },
  );

  // -------------------------------------------------------------- kayıtlar
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/players/:id/records',
    // Not, uyarı ve takip aynı tabloda ama aynı yetki değil: uyarı vermek
    // oyuncuya görünen bir eylem, not yazmak değil.
    { preHandler: requireSession(db, 'player.note.write') },
    async (req, reply) => {
      const playerId = uuid.safeParse(req.params.id);
      if (!playerId.success) return reply.code(400).send({ error: 'gecersiz_oyuncu_id' });

      const parsed = RecordBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'gecersiz_girdi', detay: ilkHata(parsed.error) });
      }
      const actor = req.authSession;
      if (
        parsed.data.kind === 'warning' &&
        !actor?.permissions.includes('player.warn') &&
        actor?.systemRole !== 'super_admin'
      ) {
        return reply.code(403).send({ error: 'forbidden', required: 'player.warn' });
      }
      if (!(await playerVarMi(playerId.data))) {
        return reply.code(404).send({ error: 'oyuncu_bulunamadi' });
      }

      const kayit = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(moderationSchema.playerRecords)
          .values({
            playerId: playerId.data,
            kind: parsed.data.kind,
            body: parsed.data.body,
            serverId: parsed.data.serverId ?? null,
            authorUserId: actor?.id ?? null,
            authorName: actor?.discordUsername ?? null,
            source: 'altai',
          })
          .returning();
        if (!created) throw new Error('kayıt eklenemedi');

        await writeAudit(tx, {
          actorUserId: actor?.id ?? null,
          action: 'record.create',
          targetType: 'player_record',
          targetId: created.id,
          payload: { playerId: playerId.data, kind: parsed.data.kind },
        });
        return created;
      });

      return reply.code(201).send({ record: kayit });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/records/:id/resolve',
    { preHandler: requireSession(db, 'player.note.write') },
    async (req, reply) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) return reply.code(400).send({ error: 'gecersiz_kayit_id' });

      const actor = req.authSession;
      const sonuc = await db.transaction(async (tx) => {
        const [mevcut] = await tx
          .select({ id: moderationSchema.playerRecords.id })
          .from(moderationSchema.playerRecords)
          .where(
            and(
              eq(moderationSchema.playerRecords.id, id.data),
              isNull(moderationSchema.playerRecords.resolvedAt),
            ),
          )
          .limit(1);
        if (!mevcut) return null;

        const [guncel] = await tx
          .update(moderationSchema.playerRecords)
          .set({ resolvedAt: new Date(), updatedAt: new Date() })
          .where(eq(moderationSchema.playerRecords.id, id.data))
          .returning();

        await writeAudit(tx, {
          actorUserId: actor?.id ?? null,
          action: 'record.resolve',
          targetType: 'player_record',
          targetId: id.data,
        });
        return guncel;
      });

      if (!sonuc) return reply.code(404).send({ error: 'acik_kayit_bulunamadi' });
      return { record: sonuc };
    },
  );

  // ---------------------------------------------------------------- flagler
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/players/:id/flags',
    { preHandler: requireSession(db, 'flag.manage') },
    async (req, reply) => {
      const playerId = uuid.safeParse(req.params.id);
      if (!playerId.success) return reply.code(400).send({ error: 'gecersiz_oyuncu_id' });

      const parsed = FlagBody.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'gecersiz_girdi', detay: ilkHata(parsed.error) });
      }
      if (!(await playerVarMi(playerId.data))) {
        return reply.code(404).send({ error: 'oyuncu_bulunamadi' });
      }

      const [flag] = await db
        .select({ id: moderationSchema.flags.id })
        .from(moderationSchema.flags)
        .where(eq(moderationSchema.flags.id, parsed.data.flagId))
        .limit(1);
      if (!flag) return reply.code(404).send({ error: 'flag_bulunamadi' });

      const actor = req.authSession;
      const sonuc = await db.transaction(async (tx) => {
        // Aynı flag zaten aktifse ikinci kez atamıyoruz: profil aynı rozeti
        // iki kez gösterirdi ve "ne zamandan beri" belirsizleşirdi.
        const [acik] = await tx
          .select({ id: moderationSchema.flagAssignments.id })
          .from(moderationSchema.flagAssignments)
          .where(
            and(
              eq(moderationSchema.flagAssignments.playerId, playerId.data),
              eq(moderationSchema.flagAssignments.flagId, parsed.data.flagId),
              isNull(moderationSchema.flagAssignments.removedAt),
            ),
          )
          .limit(1);
        if (acik) return { durum: 'zaten_var' as const };

        const [created] = await tx
          .insert(moderationSchema.flagAssignments)
          .values({
            playerId: playerId.data,
            flagId: parsed.data.flagId,
            addedByUserId: actor?.id ?? null,
            addedByName: actor?.discordUsername ?? null,
            source: 'altai',
          })
          .returning();
        if (!created) throw new Error('flag atanamadı');

        await writeAudit(tx, {
          actorUserId: actor?.id ?? null,
          action: 'flag.assign',
          targetType: 'flag_assignment',
          targetId: created.id,
          payload: { playerId: playerId.data, flagId: parsed.data.flagId },
        });
        return { durum: 'ok' as const, assignment: created };
      });

      if (sonuc.durum === 'zaten_var') return reply.code(409).send({ error: 'flag_zaten_atanmis' });
      return reply.code(201).send({ assignment: sonuc.assignment });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/flag-assignments/:id/remove',
    { preHandler: requireSession(db, 'flag.manage') },
    async (req, reply) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) return reply.code(400).send({ error: 'gecersiz_atama_id' });

      const actor = req.authSession;
      const sonuc = await db.transaction(async (tx) => {
        const [acik] = await tx
          .select({ id: moderationSchema.flagAssignments.id })
          .from(moderationSchema.flagAssignments)
          .where(
            and(
              eq(moderationSchema.flagAssignments.id, id.data),
              isNull(moderationSchema.flagAssignments.removedAt),
            ),
          )
          .limit(1);
        if (!acik) return null;

        const [guncel] = await tx
          .update(moderationSchema.flagAssignments)
          .set({ removedAt: new Date() })
          .where(eq(moderationSchema.flagAssignments.id, id.data))
          .returning();

        await writeAudit(tx, {
          actorUserId: actor?.id ?? null,
          action: 'flag.remove',
          targetType: 'flag_assignment',
          targetId: id.data,
        });
        return guncel;
      });

      if (!sonuc) return reply.code(404).send({ error: 'acik_atama_bulunamadi' });
      return { assignment: sonuc };
    },
  );
}
