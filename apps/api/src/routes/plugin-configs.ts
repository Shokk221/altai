import type { Db } from '@altai/db';
import { opsSchema, presenceSchema } from '@altai/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireSession } from '../lib/auth-guard.js';
import { ayarlariYay } from '../lib/plugin-configs.js';

/**
 * Plugin ayarları — panel yüzeyi. Plan Bölüm 6 ve 8.
 *
 * "Ayar değişikliği için dosya editleyip restart atma devri kapanıyor":
 * yazma başarılı olur olmaz ayarlar bağlı agent'lara itiliyor, agent
 * plugin'i kapatıp yeni ayarla açıyor. Sunucu yeniden başlatılmıyor.
 *
 * Her değişiklik `config_audit`'e öncesi/sonrasıyla yazılıyor — bir eşiğin
 * ne zaman ve kim tarafından değiştiği aylar sonra sorulan bir soru.
 */

const uuid = z.string().uuid();

const UpsertBody = z.object({
  pluginName: z.string().trim().min(1).max(100),
  /** null = tüm sunucular. */
  serverId: uuid.nullish(),
  enabled: z.boolean(),
  config: z.record(z.unknown()).default({}),
});

function ilkHata(err: z.ZodError): string {
  const i = err.issues[0];
  if (!i) return 'geçersiz girdi';
  return i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message;
}

export async function pluginConfigRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;
  // Plugin ayarı değiştirmek canlı sunucunun davranışını değiştiriyor —
  // moderasyon değil sunucu kontrolü yetkisi.
  const guard = requireSession(db, 'plugin_config.write');

  app.get('/plugin-configs', { preHandler: guard }, async () => {
    const [satirlar, sunucular] = await Promise.all([
      db.select().from(opsSchema.pluginConfigs).orderBy(opsSchema.pluginConfigs.pluginName),
      db
        .select({ id: presenceSchema.servers.id, slug: presenceSchema.servers.slug })
        .from(presenceSchema.servers),
    ]);
    return { configs: satirlar, servers: sunucular };
  });

  /** Ayar geçmişi — "bu eşik ne zaman değişti". */
  app.get<{ Querystring: { plugin?: string } }>(
    '/plugin-configs/audit',
    { preHandler: guard },
    async (req) => {
      const temel = db
        .select()
        .from(opsSchema.configAudit)
        .orderBy(desc(opsSchema.configAudit.createdAt))
        .limit(100);
      const rows = req.query.plugin
        ? await db
            .select()
            .from(opsSchema.configAudit)
            .where(eq(opsSchema.configAudit.pluginName, req.query.plugin))
            .orderBy(desc(opsSchema.configAudit.createdAt))
            .limit(100)
        : await temel;
      return { entries: rows };
    },
  );

  /**
   * Ayarı yazar (varsa günceller) ve agent'lara iter.
   *
   * PUT: aynı gövdeyi iki kez göndermek aynı sonucu veriyor. Panelden
   * "kaydet"e iki kez basmak ikinci bir satır oluşturmamalı — kapsam
   * (plugin + sunucu) doğal anahtar.
   */
  app.put<{ Body: unknown }>('/plugin-configs', { preHandler: guard }, async (req, reply) => {
    const parsed = UpsertBody.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'gecersiz_girdi', detay: ilkHata(parsed.error) });
    }
    const { pluginName, enabled, config } = parsed.data;
    const serverId = parsed.data.serverId ?? null;

    if (serverId) {
      const [s] = await db
        .select({ id: presenceSchema.servers.id })
        .from(presenceSchema.servers)
        .where(eq(presenceSchema.servers.id, serverId))
        .limit(1);
      if (!s) return reply.code(404).send({ error: 'sunucu_bulunamadi' });
    }

    const actor = req.authSession;
    const sonuc = await db.transaction(async (tx) => {
      // Kapsam eşleşmesinde `= null` çalışmaz; NULL karşılaştırması
      // `is null` olmak zorunda. Bu ayrım atlanırsa genel satır hiç
      // bulunamaz ve her kayıtta yenisi yazılmaya çalışılır.
      const kapsam = serverId
        ? and(
            eq(opsSchema.pluginConfigs.pluginName, pluginName),
            eq(opsSchema.pluginConfigs.serverId, serverId),
          )
        : and(
            eq(opsSchema.pluginConfigs.pluginName, pluginName),
            isNull(opsSchema.pluginConfigs.serverId),
          );

      const [mevcut] = await tx.select().from(opsSchema.pluginConfigs).where(kapsam).limit(1);

      const [yeni] = mevcut
        ? await tx
            .update(opsSchema.pluginConfigs)
            .set({
              enabled,
              config,
              updatedAt: new Date(),
              updatedByUserId: actor?.id ?? null,
            })
            .where(eq(opsSchema.pluginConfigs.id, mevcut.id))
            .returning()
        : await tx
            .insert(opsSchema.pluginConfigs)
            .values({
              pluginName,
              serverId,
              enabled,
              config,
              updatedByUserId: actor?.id ?? null,
            })
            .returning();

      await tx.insert(opsSchema.configAudit).values({
        pluginName,
        serverId,
        action: mevcut ? 'update' : 'create',
        onceki: mevcut ? { enabled: mevcut.enabled, config: mevcut.config } : null,
        sonraki: { enabled, config },
        actorUserId: actor?.id ?? null,
        actorLabel: actor?.discordUsername ?? null,
      });

      return yeni;
    });

    // Hot-reload. Agent kopuksa bu sessizce boş döner ve sorun değil:
    // bağlandığında ayarları hello_ack'in ardından zaten alıyor.
    const gidenler = await ayarlariYay(db);

    return { config: sonuc, itildi: gidenler };
  });

  app.delete<{ Params: { id: string } }>(
    '/plugin-configs/:id',
    { preHandler: guard },
    async (req, reply) => {
      const id = uuid.safeParse(req.params.id);
      if (!id.success) return reply.code(400).send({ error: 'gecersiz_id' });

      const [mevcut] = await db
        .select()
        .from(opsSchema.pluginConfigs)
        .where(eq(opsSchema.pluginConfigs.id, id.data))
        .limit(1);
      if (!mevcut) return reply.code(404).send({ error: 'ayar_bulunamadi' });

      const actor = req.authSession;
      await db.transaction(async (tx) => {
        await tx.delete(opsSchema.pluginConfigs).where(eq(opsSchema.pluginConfigs.id, id.data));
        // Silinen satırın tamamı payload'da: ayar config, moderasyon kaydı
        // değil — silinebilir, ama geri kurulabilir olmalı.
        await tx.insert(opsSchema.configAudit).values({
          pluginName: mevcut.pluginName,
          serverId: mevcut.serverId,
          action: 'delete',
          onceki: { enabled: mevcut.enabled, config: mevcut.config },
          sonraki: null,
          actorUserId: actor?.id ?? null,
          actorLabel: actor?.discordUsername ?? null,
        });
      });

      const gidenler = await ayarlariYay(db);
      return { ok: true, itildi: gidenler };
    },
  );
}
