import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as identity from './schema/identity.js';

export function createDb(connectionString: string) {
  const queryClient = postgres(connectionString);
  return drizzle(queryClient, { schema: { ...identity } });
}

export type Db = ReturnType<typeof createDb>;
