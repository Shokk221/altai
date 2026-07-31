import { PERMISSIONS } from '@altai/contracts';
import { eq } from 'drizzle-orm';
import { createDb } from './client.js';
import { roleMappings } from './schema/identity.js';

// İlk kurulumda role_mappings boştur -> hiç kimse hiçbir izne sahip olamaz
// (Discord üzerinden giriş yapılabilir ama panelde hiçbir şey yapılamaz).
// Bu script BOOTSTRAP_DISCORD_ROLE_ID ile belirtilen Discord rolünü
// super_admin + tüm izinlerle eşler; o rolü taşıyan ilk kişi giriş yaptığında
// tam yetkili olur ve rol eşlemelerini panelden düzenlemeye devam eder.
//
// Kullanım: BOOTSTRAP_DISCORD_ROLE_ID=... DATABASE_URL=... pnpm db:seed:bootstrap-admin

const databaseUrl = process.env.DATABASE_URL;
const bootstrapRoleId = process.env.BOOTSTRAP_DISCORD_ROLE_ID;

if (!databaseUrl) throw new Error('DATABASE_URL tanımlı değil');
if (!bootstrapRoleId) throw new Error('BOOTSTRAP_DISCORD_ROLE_ID tanımlı değil');

const db = createDb(databaseUrl);

const [existing] = await db
  .select()
  .from(roleMappings)
  .where(eq(roleMappings.discordRoleId, bootstrapRoleId))
  .limit(1);

if (existing) {
  await db
    .update(roleMappings)
    .set({ systemRole: 'super_admin', permissions: [...PERMISSIONS] })
    .where(eq(roleMappings.discordRoleId, bootstrapRoleId));
  console.log(`Güncellendi: ${bootstrapRoleId} -> super_admin (tüm izinler)`);
} else {
  await db.insert(roleMappings).values({
    discordRoleId: bootstrapRoleId,
    systemRole: 'super_admin',
    permissions: [...PERMISSIONS],
  });
  console.log(`Oluşturuldu: ${bootstrapRoleId} -> super_admin (tüm izinler)`);
}

process.exit(0);
