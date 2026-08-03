import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as identity from './schema/identity.js';
import * as presence from './schema/presence.js';

export function createDb(connectionString: string) {
  const queryClient = postgres(connectionString);
  return drizzle(queryClient, { schema: { ...identity, ...presence } });
}

export type Db = ReturnType<typeof createDb>;
