import type { Db } from '@altai/db';
import type { AppConfig } from '@altai/shared';
import type { FastifyInstance } from 'fastify';
import { formatAdminList } from '../lib/admin-list-format.js';
import { adminKayitlari, serverIdBySlug } from '../lib/admin-registry.js';
import { timingSafeCompare } from '../lib/timing-safe.js';

/**
 * Squad remote admin list — plan Bölüm 5.
 *
 * İki ayrı kaynak, bilinçli olarak ayrı tutuluyor:
 *
 *  YETKİLİ GRUPLAR (kick/ban/cheat...) yalnızca DISCORD'dan gelir.
 *    discord_member_roles -> role_mappings.squad_group -> Admins.cfg
 *    Discord'da rol alınınca oyun içi yetki de düşer. Elle admin ekleme
 *    yolu YOK — iki paralel yetki mekanizması eski sistemin hatasıydı.
 *
 *  WHITELIST GRUPLARI (yalnızca `reserve`) elle verilir.
 *    grants -> Admins.cfg
 *    Klan üyesi ya da bağışçı olan birinin Discord'da bulunması gerekmiyor.
 *
 * Karışmaları engelli: elle verilmiş bir grant yetkili bir gruba yazamaz
 * (grup grant_mode='discord' ise atlanır ve loglanır).
 *
 * SUNUCU FİLTRESİ: `?server=<slug>`. Hem gruplar hem grant'lar sunucuya
 * bağlanabiliyor (`server_id`); NULL = tüm sunucular. Filtre verilmezse
 * yalnızca küresel kayıtlar döner — çünkü sunucuya özel bir whitelist'in
 * başka bir sunucuya sızması, sızmaması gerekenden daha kötü. Ban listesi
 * ucu da aynı mantığı kullanıyor.
 */

export async function adminListRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig }) {
  const { db, config } = opts;

  app.get<{ Params: { token: string }; Querystring: { server?: string } }>(
    '/admin-list/:token',
    async (req, reply) => {
      const token = req.params.token.replace(/\.cfg$/i, '');
      if (!config.ADMIN_LIST_TOKEN || !timingSafeCompare(token, config.ADMIN_LIST_TOKEN)) {
        return reply.code(404).type('text/plain; charset=utf-8').send('');
      }

      // Sunucu çözümlemesi: bilinmeyen slug 404 — yanlış yazılmış bir slug
      // sessizce "tüm sunucular" listesine düşerse yetki sızar.
      const slug = req.query.server;
      let serverId: string | null = null;
      if (slug) {
        serverId = await serverIdBySlug(db, slug);
        if (!serverId) return reply.code(404).type('text/plain; charset=utf-8').send('');
      }

      const now = new Date();
      // Sorgu lib'e taşındı: agent'a itilen liste de aynı kaynaktan
      // üretiliyor, yoksa oyun içi yetki ile plugin muafiyeti ayrışırdı.
      const kayit = await adminKayitlari(db, serverId);
      const { groups, entries, adminEntries, rejectedGrants } = kayit;

      if (rejectedGrants > 0) {
        req.log.warn(
          { rejectedGrants },
          'yetkili gruba elle verilmiş grant atlandı — admin yetkisi yalnızca Discord üzerinden',
        );
      }

      const result = formatAdminList({
        groups,
        entries,
        now,
        ...(kayit.rolesSyncedAt ? { rolesSyncedAt: kayit.rolesSyncedAt } : {}),
      });

      // EMNİYET SUPABI — yalnızca ADMIN sayısına bakar. Whitelist kayıtları
      // dolu olsa bile adminler kaybolmuşsa liste servis edilmemeli.
      // Eşleme hiç tanımlanmamışsa bu beklenen bir durum, hata değil.
      if (kayit.mappingCount > 0 && adminEntries === 0) {
        req.log.error(
          { mappings: kayit.mappingCount, adminEntries },
          'rol eşlemesi var ama hiç admin çıkmadı — liste SERVİS EDİLMEDİ',
        );
        return reply
          .code(503)
          .type('text/plain; charset=utf-8')
          .send(
            '// Admin listesi üretilemedi: rol eşlemesi tanımlı ama hiç admin bulunamadı.\n' +
              '// Discord rol senkronu çalışmıyor olabilir. Sunucu son listeyi korumalı.\n',
          );
      }

      return reply
        .type('text/plain; charset=utf-8')
        .header('cache-control', 'public, max-age=60')
        .send(result.body);
    },
  );
}
