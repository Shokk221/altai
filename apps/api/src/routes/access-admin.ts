import { PERMISSIONS, type Permission, SYSTEM_ROLES, type SystemRole } from '@altai/contracts';
import type { Db } from '@altai/db';
import { accessSchema } from '@altai/db';
import type { AppConfig } from '@altai/shared';
import { and, asc, eq, gt, isNull, max, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../lib/audit.js';
import { requireSession } from '../lib/auth-guard.js';
import { discordRolleri } from '../lib/discord-roles.js';
import {
  GrupGovdesi,
  YeniGrupGovdesi,
  grupTuruHatasi,
  izinleriOku,
  izinleriYaz,
  turDegisimiHatasi,
} from '../lib/squad-groups.js';

/**
 * Yetki yönetimi — Discord rolü → panel izinleri + oyun içi grup.
 *
 * Şimdiye kadar eşlemeler yalnızca komut satırından ekleniyordu; yani yetki
 * dağıtımı sunucuya SSH erişimi olan kişiye bağlıydı. Yetki zincirinin
 * BAŞLANGICI burası ve panelden yönetilebilmesi gerekiyor.
 *
 * Yetki `admin_list.manage` — bilerek dar. Bu uçlar kendine süper admin
 * verebilecek gücü taşıyor.
 */

const RolBody = z.object({
  discordRoleId: z.string().regex(/^\d{17,20}$/, 'Discord rol kimliği 17-20 haneli sayı olmalı'),
  systemRole: z.enum(SYSTEM_ROLES),
  panelPermissions: z.array(z.enum(PERMISSIONS)),
  /** null = oyun içi yetki vermez, yalnızca panel erişimi. */
  squadGroup: z.string().trim().min(1).nullish(),
});

function ilkHata(err: z.ZodError): string {
  const i = err.issues[0];
  if (!i) return 'geçersiz girdi';
  return i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message;
}

export async function accessAdminRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig }) {
  const { db, config } = opts;
  const guard = requireSession(db, 'admin_list.manage');

  /** Grup adı başına: kaç Discord eşlemesi ve kaç aktif elle kayıt bağlı. */
  async function grupKullanimi() {
    const simdi = new Date();
    const [eslemeler, grantlar] = await Promise.all([
      db
        .select({
          ad: accessSchema.roleMappings.squadGroup,
          n: sql<number>`count(*)::int`,
        })
        .from(accessSchema.roleMappings)
        .groupBy(accessSchema.roleMappings.squadGroup),
      db
        .select({ ad: accessSchema.grants.groupName, n: sql<number>`count(*)::int` })
        .from(accessSchema.grants)
        .where(
          and(
            isNull(accessSchema.grants.revokedAt),
            or(isNull(accessSchema.grants.expiresAt), gt(accessSchema.grants.expiresAt, simdi)),
          ),
        )
        .groupBy(accessSchema.grants.groupName),
    ]);
    return {
      esleme: new Map(eslemeler.filter((r) => r.ad).map((r) => [r.ad as string, r.n])),
      grant: new Map(grantlar.map((r) => [r.ad, r.n])),
    };
  }

  /** Eşlemeler + gruplar + Discord rolleri + form seçenekleri tek istekte. */
  app.get('/role-mappings', { preHandler: guard }, async () => {
    const [mappings, gruplar, senkron, sayim, kullanim, discord] = await Promise.all([
      db
        .select()
        .from(accessSchema.roleMappings)
        .orderBy(asc(accessSchema.roleMappings.systemRole)),
      db
        .select({
          id: accessSchema.squadAdminGroups.id,
          name: accessSchema.squadAdminGroups.name,
          squadPermissions: accessSchema.squadAdminGroups.squadPermissions,
          grantMode: accessSchema.squadAdminGroups.grantMode,
          serverId: accessSchema.squadAdminGroups.serverId,
        })
        .from(accessSchema.squadAdminGroups)
        .orderBy(asc(accessSchema.squadAdminGroups.name)),
      db
        .select({ son: max(accessSchema.discordMemberRoles.syncedAt) })
        .from(accessSchema.discordMemberRoles),
      // Rol başına üye sayısı: "bu eşlemeyi değiştirirsem kaç kişiyi
      // etkilerim" sorusu, değiştirmeden önce sorulması gereken soru.
      db
        .select({
          roleId: accessSchema.discordMemberRoles.discordRoleId,
          n: sql<number>`count(*)::int`,
        })
        .from(accessSchema.discordMemberRoles)
        .groupBy(accessSchema.discordMemberRoles.discordRoleId),
      grupKullanimi(),
      // Discord'a ulaşılamazsa sayfa yine açılıyor: eşlemeler veritabanında,
      // yalnızca rol adları eksik kalıyor ve form elle kimlik girişine düşüyor.
      discordRolleri(config.DISCORD_BOT_TOKEN, config.DISCORD_GUILD_ID),
    ]);

    const uyeler = new Map(sayim.map((r) => [r.roleId, r.n]));

    return {
      mappings: mappings.map((m) => ({ ...m, uyeSayisi: uyeler.get(m.discordRoleId) ?? 0 })),
      squadGroups: gruplar.map((g) => ({
        ...g,
        squadPermissions: izinleriOku(g.squadPermissions),
        eslemeSayisi: kullanim.esleme.get(g.name) ?? 0,
        grantSayisi: kullanim.grant.get(g.name) ?? 0,
      })),
      discordRoles: 'roller' in discord ? discord.roller : null,
      discordHata: 'hata' in discord ? discord.hata : null,
      permissions: PERMISSIONS,
      systemRoles: SYSTEM_ROLES,
      sonSenkron: senkron[0]?.son ?? null,
    };
  });

  /** Oluştur ya da güncelle. Aynı Discord rolü tek eşleme taşır. */
  app.post<{ Body: unknown }>('/role-mappings', { preHandler: guard }, async (req, reply) => {
    const parsed = RolBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'gecersiz_girdi', detay: ilkHata(parsed.error) });
    }
    const { discordRoleId, systemRole, panelPermissions, squadGroup } = parsed.data;

    // Olmayan bir grup adı Admins.cfg'ye yazılır ve Squad o satırı SESSİZCE
    // yok sayar — yetki verdiğini sanıp vermemiş olursun.
    // Whitelist (elle) grubuna Discord rolü bağlamak serbest: "VIP rolü
    // rezerve slot versin" geçerli bir kullanım ve admin listesi bunu kabul
    // ediyor. Kısıt yalnızca ters yönde (yetkili grubun elle verilmesi).
    if (squadGroup) {
      const [g] = await db
        .select({ name: accessSchema.squadAdminGroups.name })
        .from(accessSchema.squadAdminGroups)
        .where(eq(accessSchema.squadAdminGroups.name, squadGroup))
        .limit(1);
      if (!g) return reply.code(400).send({ error: 'grup_yok', detay: squadGroup });
    }

    const actor = req.authSession;
    const { row, yeni } = await db.transaction(async (tx) => {
      const [mevcut] = await tx
        .select({ id: accessSchema.roleMappings.id })
        .from(accessSchema.roleMappings)
        .where(eq(accessSchema.roleMappings.discordRoleId, discordRoleId))
        .limit(1);

      const degerler = {
        systemRole: systemRole as SystemRole,
        panelPermissions: panelPermissions as Permission[],
        squadGroup: squadGroup ?? null,
      };

      const [kaydedilen] = mevcut
        ? await tx
            .update(accessSchema.roleMappings)
            .set(degerler)
            .where(eq(accessSchema.roleMappings.id, mevcut.id))
            .returning()
        : await tx
            .insert(accessSchema.roleMappings)
            .values({ discordRoleId, ...degerler })
            .returning();
      if (!kaydedilen) throw new Error('rol eşlemesi kaydedilemedi');

      await writeAudit(tx, {
        actorUserId: actor?.id ?? null,
        actorLabel: actor?.discordUsername ?? null,
        requestId: String(req.id),
        action: 'role_mapping.upsert',
        targetType: 'role_mapping',
        targetId: kaydedilen.id,
        payload: { discordRoleId, systemRole, squadGroup, izinSayisi: panelPermissions.length },
      });
      return { row: kaydedilen, yeni: !mevcut };
    });

    return reply.code(yeni ? 201 : 200).send({ mapping: row });
  });

  /**
   * Eşlemeyi kaldır.
   *
   * Silmek, o rolü taşıyan herkesin panel yetkisini ve oyun içi grubunu
   * düşürür. Kayıt tutulmuyor (eşleme tarihçesi değil yapılandırma) ama
   * denetim günlüğüne yazılıyor.
   */
  app.post<{ Params: { id: string } }>(
    '/role-mappings/:id/delete',
    { preHandler: guard },
    async (req, reply) => {
      const id = z.string().uuid().safeParse(req.params.id);
      if (!id.success) return reply.code(400).send({ error: 'gecersiz_id' });

      const actor = req.authSession;
      const silinen = await db.transaction(async (tx) => {
        const [row] = await tx
          .delete(accessSchema.roleMappings)
          .where(eq(accessSchema.roleMappings.id, id.data))
          .returning();
        if (!row) return null;
        await writeAudit(tx, {
          actorUserId: actor?.id ?? null,
          actorLabel: actor?.discordUsername ?? null,
          requestId: String(req.id),
          action: 'role_mapping.delete',
          targetType: 'role_mapping',
          targetId: row.id,
          payload: { discordRoleId: row.discordRoleId, systemRole: row.systemRole },
        });
        return row;
      });

      if (!silinen) return reply.code(404).send({ error: 'esleme_bulunamadi' });
      return { silindi: silinen.discordRoleId };
    },
  );

  /**
   * Yeni oyun içi grup.
   *
   * Yalnızca KÜRESEL grup (tüm sunucular) açılıyor; sunucuya özel gruplar
   * içe aktarmadan geliyor ve listede görünüyor. Aynı adda ikinci küresel
   * grup engelleniyor: tekil indeks (ad, sunucu) NULL sunucuyu ayrı sayıyor
   * ve iki "Admin" grubu Admins.cfg'de çakışırdı.
   */
  app.post<{ Body: unknown }>('/squad-groups', { preHandler: guard }, async (req, reply) => {
    const parsed = YeniGrupGovdesi.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'gecersiz_girdi', detay: ilkHata(parsed.error) });
    }
    const { name, squadPermissions, grantMode } = parsed.data;
    const turHatasi = grupTuruHatasi(squadPermissions, grantMode);
    if (turHatasi) return reply.code(400).send({ error: 'gecersiz_tur', detay: turHatasi });

    const [ayniAd] = await db
      .select({ id: accessSchema.squadAdminGroups.id })
      .from(accessSchema.squadAdminGroups)
      .where(
        and(
          eq(accessSchema.squadAdminGroups.name, name),
          isNull(accessSchema.squadAdminGroups.serverId),
        ),
      )
      .limit(1);
    if (ayniAd) return reply.code(409).send({ error: 'grup_var', detay: name });

    const actor = req.authSession;
    const row = await db.transaction(async (tx) => {
      const [kaydedilen] = await tx
        .insert(accessSchema.squadAdminGroups)
        .values({ name, squadPermissions: izinleriYaz(squadPermissions), grantMode })
        .returning();
      if (!kaydedilen) throw new Error('grup kaydedilemedi');
      await writeAudit(tx, {
        actorUserId: actor?.id ?? null,
        actorLabel: actor?.discordUsername ?? null,
        requestId: String(req.id),
        action: 'squad_group.upsert',
        targetType: 'squad_group',
        targetId: kaydedilen.id,
        targetLabel: name,
        payload: { yeni: true, izinler: kaydedilen.squadPermissions, tur: grantMode },
      });
      return kaydedilen;
    });

    return reply.code(201).send({ group: row });
  });

  /**
   * Grubun izinlerini ya da türünü değiştir.
   *
   * Ad DEĞİŞMİYOR: eşlemeler ve elle kayıtlar gruba adıyla bağlı; ad
   * değişince hepsi sessizce boşa düşerdi. Yeni ad gerekiyorsa yeni grup.
   */
  app.post<{ Params: { id: string }; Body: unknown }>(
    '/squad-groups/:id',
    { preHandler: guard },
    async (req, reply) => {
      const id = z.string().uuid().safeParse(req.params.id);
      if (!id.success) return reply.code(400).send({ error: 'gecersiz_id' });
      const parsed = GrupGovdesi.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'gecersiz_girdi', detay: ilkHata(parsed.error) });
      }
      const { squadPermissions, grantMode } = parsed.data;
      const turHatasi = grupTuruHatasi(squadPermissions, grantMode);
      if (turHatasi) return reply.code(400).send({ error: 'gecersiz_tur', detay: turHatasi });

      const [mevcut] = await db
        .select()
        .from(accessSchema.squadAdminGroups)
        .where(eq(accessSchema.squadAdminGroups.id, id.data))
        .limit(1);
      if (!mevcut) return reply.code(404).send({ error: 'grup_bulunamadi' });

      if (mevcut.grantMode !== grantMode) {
        const kullanim = await grupKullanimi();
        const hata = turDegisimiHatasi(grantMode, kullanim.grant.get(mevcut.name) ?? 0);
        if (hata) return reply.code(409).send({ error: 'tur_degisemez', detay: hata });
      }

      const actor = req.authSession;
      const row = await db.transaction(async (tx) => {
        const [kaydedilen] = await tx
          .update(accessSchema.squadAdminGroups)
          .set({ squadPermissions: izinleriYaz(squadPermissions), grantMode })
          .where(eq(accessSchema.squadAdminGroups.id, mevcut.id))
          .returning();
        if (!kaydedilen) throw new Error('grup kaydedilemedi');
        await writeAudit(tx, {
          actorUserId: actor?.id ?? null,
          actorLabel: actor?.discordUsername ?? null,
          requestId: String(req.id),
          action: 'squad_group.upsert',
          targetType: 'squad_group',
          targetId: kaydedilen.id,
          targetLabel: kaydedilen.name,
          // Öncesi de yazılıyor: "kameraman yetkisini kim kaldırdı"
          // sorusunun cevabı ancak farkla okunabiliyor.
          payload: {
            onceki: { izinler: mevcut.squadPermissions, tur: mevcut.grantMode },
            yeni: { izinler: kaydedilen.squadPermissions, tur: grantMode },
          },
        });
        return kaydedilen;
      });

      return { group: row };
    },
  );

  /**
   * Grubu sil — yalnızca kimse kullanmıyorsa.
   *
   * Bağlı eşleme ya da aktif elle kayıt varken silmek, o kişilerin oyun içi
   * yetkisini ve slotunu sessizce düşürürdü. Önce bağlar kaldırılmalı.
   */
  app.post<{ Params: { id: string } }>(
    '/squad-groups/:id/delete',
    { preHandler: guard },
    async (req, reply) => {
      const id = z.string().uuid().safeParse(req.params.id);
      if (!id.success) return reply.code(400).send({ error: 'gecersiz_id' });

      const [mevcut] = await db
        .select()
        .from(accessSchema.squadAdminGroups)
        .where(eq(accessSchema.squadAdminGroups.id, id.data))
        .limit(1);
      if (!mevcut) return reply.code(404).send({ error: 'grup_bulunamadi' });

      const kullanim = await grupKullanimi();
      const esleme = kullanim.esleme.get(mevcut.name) ?? 0;
      const grant = kullanim.grant.get(mevcut.name) ?? 0;
      if (esleme > 0 || grant > 0) {
        return reply.code(409).send({
          error: 'grup_kullaniliyor',
          detay: `Bu gruba ${esleme} Discord rolü ve ${grant} elle kayıt bağlı. Önce onları kaldırın.`,
        });
      }

      const actor = req.authSession;
      await db.transaction(async (tx) => {
        await tx
          .delete(accessSchema.squadAdminGroups)
          .where(eq(accessSchema.squadAdminGroups.id, mevcut.id));
        await writeAudit(tx, {
          actorUserId: actor?.id ?? null,
          actorLabel: actor?.discordUsername ?? null,
          requestId: String(req.id),
          action: 'squad_group.delete',
          targetType: 'squad_group',
          targetId: mevcut.id,
          targetLabel: mevcut.name,
          payload: { izinler: mevcut.squadPermissions, tur: mevcut.grantMode },
        });
      });

      return { silindi: mevcut.name };
    },
  );
}
