import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL tanımlı değil');
}

const db = createDb(databaseUrl);
await migrate(db, { migrationsFolder: './migrations' });
console.log('Migrasyonlar tamamlandı.');
process.exit(0);
