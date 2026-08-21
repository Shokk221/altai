import type { Permission } from '@altai/contracts';
import type { Db } from '@altai/db';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { verifySession } from './session.js';

export const SESSION_COOKIE = 'altai_session';

/**
 * Oturum zorunluluğu.
 *
 * Canlı sunucu durumu uçları (/servers, /ws) başta herkese açıktı. Bu, oyuncu
 * isimlerini ve SteamID'lerini kimlik doğrulaması olmadan yayınlamak
 * demekti — eski BM panelinin herkese kapatılmış olmasının sebebi de buydu.
 * Gerçek kurulumda doğrulandı (curl ile 200 döndü), sonra bu koruma yazıldı.
 */
export function requireSession(db: Db, permission?: Permission | Permission[]) {
  // Birden fazla izin verilirse HERHANGİ BİRİ yetiyor.
  //
  // Bunu tek izinli hâlde bırakmak sessiz bir hataya yol açmıştı: klan
  // yönetimi `plugin_config.write`, klan savaşları `clan.manage`
  // istiyordu. İkinci izne sahip biri savaş sayfasını açabiliyor ama
  // sayfanın doldurduğu klan listesi 403 dönüyordu — açılır menü boş
  // kalıyor ve kullanıcı neden taraf ekleyemediğini anlamıyordu.
  const izinler =
    permission === undefined ? [] : Array.isArray(permission) ? permission : [permission];

  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (!token) {
      await reply.code(401).send({ error: 'no_session' });
      return reply;
    }

    const session = await verifySession(db, token);
    if (!session) {
      await reply.code(401).send({ error: 'invalid_session' });
      return reply;
    }

    if (
      izinler.length > 0 &&
      !izinler.some((p) => session.permissions.includes(p)) &&
      session.systemRole !== 'super_admin'
    ) {
      // `required` dizi olarak dönüyor: hangi izinlerden birinin
      // yeteceğini görmek, tek bir ad görmekten daha kullanışlı.
      await reply.code(403).send({ error: 'forbidden', required: izinler });
      return reply;
    }

    req.authSession = session;
    return undefined;
  };
}
