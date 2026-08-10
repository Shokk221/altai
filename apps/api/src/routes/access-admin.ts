import { PERMISSIONS, type Permission, SYSTEM_ROLES, type SystemRole } from '@altai/contracts';
import type { Db } from '@altai/db';
import { accessSchema } from '@altai/db';
import { asc, eq, max, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { writeAudit } from '../lib/audit.js';
import { requireSession } from '../lib/auth-guard.js';

/**
 * Rol eşlemesi yönetimi — plan Faz 2 "Discord rol eşleme yönetim UI".
 *
 * Şimdiye kadar eşlemeler yalnızca komut satırından ekleniyordu; yani yetki
 * dağıtımı sunucuya SSH erişimi olan kişiye bağlıydı. Yetki zincirinin
 * BAŞLANGICI burası ve panelden yönetilebilmesi gerekiyor.
 *
 * Yetki `admin_list.manage` — bilerek dar. Bu uç kendine süper admin
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

export async function accessAdminRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  const guard = requireSession(db, 'admin_list.manage');

  /** Eşlemeler + form seçenekleri tek istekte. */
  app.get('/role-mappings', { preHandler: guard }, async () => {
    const [mappings, gruplar, senkron, sayim] = await Promise.all([
      db
        .select()
        .from(accessSchema.roleMappings)
        .orderBy(asc(accessSchema.roleMappings.systemRole)),
      db
        .select({
          name: accessSchema.squadAdminGroups.name,
          squadPermissions: accessSchema.squadAdminGroups.squadPermissions,
          grantMode: accessSchema.squadAdminGroups.grantMode,
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
    ]);

    const uyeler = new Map(sayim.map((r) => [r.roleId, r.n]));

    return {
      mappings: mappings.map((m) => ({ ...m, uyeSayisi: uyeler.get(m.discordRoleId) ?? 0 })),
      squadGroups: gruplar,
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
}
