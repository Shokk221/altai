import { randomBytes } from 'node:crypto';
import type { Permission, SystemRole } from '@altai/contracts';
import type { Db } from '@altai/db';
import { identitySchema } from '@altai/db';
import { eq } from 'drizzle-orm';
import { canliYetki } from './roles.js';

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 gün

export interface CreateSessionInput {
  userId: string;
  systemRole: SystemRole;
  permissions: Permission[];
  isBreakGlass?: boolean;
}

export async function createSession(
  db: Db,
  input: CreateSessionInput,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(identitySchema.sessions).values({
    token,
    userId: input.userId,
    systemRole: input.systemRole,
    permissions: input.permissions,
    isBreakGlass: input.isBreakGlass ?? false,
    expiresAt,
  });

  return { token, expiresAt };
}

export async function verifySession(db: Db, token: string) {
  const [session] = await db
    .select()
    .from(identitySchema.sessions)
    .where(eq(identitySchema.sessions.token, token))
    .limit(1);

  if (!session || session.expiresAt < new Date()) return null;

  const [user] = await db
    .select()
    .from(identitySchema.users)
    .where(eq(identitySchema.users.id, session.userId))
    .limit(1);

  if (!user) return null;

  // Yetki OTURUMDAN değil, Discord rollerinden — her istekte. Oturum yalnızca
  // "bu kişi kim" sorusunu cevaplıyor; "ne yapabilir" sorusu Discord'un şu
  // anki hâline bağlı. Oturumdaki kopya, girişteki durumun kaydı olarak
  // duruyor.
  //
  // Break-glass İSTİSNA: Discord'dan bağımsız acil giriş, Discord kesintisinde
  // de çalışmak zorunda. Yetkisi girişte sabitleniyor.
  const yetki = session.isBreakGlass
    ? {
        systemRole: session.systemRole as SystemRole,
        permissions: session.permissions as Permission[],
      }
    : await canliYetki(db, user.discordId);

  return {
    id: user.id,
    discordUsername: user.discordUsername,
    systemRole: yetki.systemRole,
    permissions: yetki.permissions,
    isBreakGlass: session.isBreakGlass,
  };
}

export async function destroySession(db: Db, token: string) {
  await db.delete(identitySchema.sessions).where(eq(identitySchema.sessions.token, token));
}
