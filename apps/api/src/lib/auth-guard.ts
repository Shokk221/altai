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
export function requireSession(db: Db, permission?: Permission) {
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
      permission &&
      !session.permissions.includes(permission) &&
      session.systemRole !== 'super_admin'
    ) {
      await reply.code(403).send({ error: 'forbidden', required: permission });
      return reply;
    }

    req.authSession = session;
    return undefined;
  };
}
