import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as access from './schema/access.js';
import * as identity from './schema/identity.js';
import * as moderation from './schema/moderation.js';
import * as presence from './schema/presence.js';

export function createDb(connectionString: string) {
  const queryClient = postgres(connectionString);
  return drizzle(queryClient, { schema: { ...identity, ...presence, ...moderation, ...access } });
}

export type Db = ReturnType<typeof createDb>;
