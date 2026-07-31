import { PERMISSIONS } from '@altai/contracts';
import type { Db } from '@altai/db';
import { identitySchema } from '@altai/db';
import type { AppConfig } from '@altai/shared';
import { verifyPassword } from '@altai/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { resolveRoles } from '../lib/roles.js';
import { createSession, destroySession, verifySession } from '../lib/session.js';

interface DiscordUser {
  id: string;
  username: string;
}

interface DiscordGuildMember {
  roles: string[];
}

const COOKIE_NAME = 'altai_session';
// Break-glass hesabının users tablosundaki sabit işareti — gerçek Discord
// ID'leriyle çakışmasın diye üretilemeyecek bir önek kullanılır.
const BREAK_GLASS_DISCORD_ID_PREFIX = 'breakglass:';

function setSessionCookie(
  reply: import('fastify').FastifyReply,
  config: AppConfig,
  token: string,
  expiresAt: Date,
) {
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function authRoutes(app: FastifyInstance, opts: { db: Db; config: AppConfig }) {
  const { db, config } = opts;

  // GET /auth/discord başlangıç yönlendirmesini @fastify/oauth2 zaten kurdu
  // (startRedirectPath). Burada sadece callback'i işliyoruz.
  app.get('/auth/discord/callback', async (req, reply) => {
    const { token } = await app.discordOAuth2.getAccessTokenFromAuthorizationCodeFlow(req);

    // 1. Discord kullanıcı kimliği
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!userRes.ok) return reply.code(502).send({ error: 'discord_user_fetch_failed' });
    const discordUser = (await userRes.json()) as DiscordUser;

    // 2. Guild üyelik rolleri — bot token ile (kullanıcı token'ının member
    //    endpoint'ine erişimi yok, guilds.members.read scope'u client'a
    //    izin vermez, bot token zorunlu).
    const memberRes = await fetch(
      `https://discord.com/api/guilds/${config.DISCORD_GUILD_ID}/members/${discordUser.id}`,
      { headers: { Authorization: `Bot ${config.DISCORD_BOT_TOKEN}` } },
    );
    const roleIds = memberRes.ok ? ((await memberRes.json()) as DiscordGuildMember).roles : [];

    // 3. Discord rolleri -> sistem rolü + izinler (tek yetki zinciri, Bölüm 8)
    const resolved = await resolveRoles(db, roleIds);

    // 4. users upsert
    const [existing] = await db
      .select()
      .from(identitySchema.users)
      .where(eq(identitySchema.users.discordId, discordUser.id))
      .limit(1);

    const user =
      existing ??
      (
        await db
          .insert(identitySchema.users)
          .values({ discordId: discordUser.id, discordUsername: discordUser.username })
          .returning()
      )[0];

    if (!user) return reply.code(500).send({ error: 'user_upsert_failed' });

    if (existing && existing.discordUsername !== discordUser.username) {
      await db
        .update(identitySchema.users)
        .set({ discordUsername: discordUser.username })
        .where(eq(identitySchema.users.id, user.id));
    }

    // 5. Session yaz + HttpOnly cookie set et (JWT yok, DB'de iptal edilebilir)
    const session = await createSession(db, {
      userId: user.id,
      systemRole: resolved.systemRole,
      permissions: resolved.permissions,
    });
    setSessionCookie(reply, config, session.token, session.expiresAt);

    app.log.info(
      { discordId: discordUser.id, systemRole: resolved.systemRole },
      'kullanıcı giriş yaptı',
    );

    reply.redirect(config.WEB_APP_URL ?? 'http://localhost:3000');
  });

  // Discord kesintisinde veya role_mappings henüz boşken kullanılan acil giriş.
  // BREAK_GLASS_USER / BREAK_GLASS_PASSWORD_HASH .env'de tanımlı değilse kapalı.
  app.post('/auth/break-glass', async (req, reply) => {
    if (!config.BREAK_GLASS_USER || !config.BREAK_GLASS_PASSWORD_HASH) {
      return reply.code(404).send({ error: 'not_configured' });
    }

    const body = req.body as { username?: string; password?: string } | undefined;
    if (!body?.username || !body?.password) {
      return reply.code(400).send({ error: 'missing_credentials' });
    }

    if (body.username !== config.BREAK_GLASS_USER) {
      return reply.code(401).send({ error: 'invalid_credentials' });
    }
    const ok = await verifyPassword(body.password, config.BREAK_GLASS_PASSWORD_HASH);
    if (!ok) return reply.code(401).send({ error: 'invalid_credentials' });

    const discordId = `${BREAK_GLASS_DISCORD_ID_PREFIX}${config.BREAK_GLASS_USER}`;
    const [existing] = await db
      .select()
      .from(identitySchema.users)
      .where(eq(identitySchema.users.discordId, discordId))
      .limit(1);

    const user =
      existing ??
      (
        await db
          .insert(identitySchema.users)
          .values({ discordId, discordUsername: config.BREAK_GLASS_USER })
          .returning()
      )[0];

    if (!user) return reply.code(500).send({ error: 'user_upsert_failed' });

    const session = await createSession(db, {
      userId: user.id,
      systemRole: 'super_admin',
      permissions: [...PERMISSIONS],
      isBreakGlass: true,
    });
    setSessionCookie(reply, config, session.token, session.expiresAt);

    app.log.warn({ username: config.BREAK_GLASS_USER }, 'break-glass girişi kullanıldı');

    return { ok: true };
  });

  app.get('/auth/me', async (req, reply) => {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return reply.code(401).send({ error: 'no_session' });

    const session = await verifySession(db, token);
    if (!session) return reply.code(401).send({ error: 'invalid_session' });

    return session;
  });

  app.post('/auth/logout', async (req, reply) => {
    const token = req.cookies[COOKIE_NAME];
    if (token) await destroySession(db, token);
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return { ok: true };
  });
}
