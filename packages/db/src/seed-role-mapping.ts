import { PERMISSIONS, type Permission, SYSTEM_ROLES, type SystemRole } from '@altai/contracts';
import { eq } from 'drizzle-orm';
import { createDb } from './client.js';
import { squadAdminGroups } from './schema/access.js';
import { roleMappings } from './schema/access.js';

/**
 * Discord rolü -> panel rolü + oyun içi grup eşlemesi kurar.
 *
 * `seed-bootstrap-admin` yalnızca super_admin üretiyor ve ilk kurulum içindi.
 * Gerçek kurulumda roller kademeli: herkeste olan bir "Admin" rolü, üstüne
 * Senior/Head/Chief gibi daha yetkili roller. Hepsini super_admin yapmak,
 * moderasyon yetkisi olan herkese rol eşlemelerini değiştirme ve kendine
 * istediği izni verme gücü verirdi.
 *
 * Kullanım:
 *   DATABASE_URL=... pnpm db:seed:role-mapping \
 *     --role <discord_rol_id> \
 *     --system <super_admin|admin|moderator|clan_leader|member> \
 *     --perms player.view,player.ban,... | all \
 *     [--squad-group Admin]     oyun içi grup (Admins.cfg); yoksa oyun yetkisi vermez
 *
 * Tekrar çalıştırılabilir: aynı rol için eşleme varsa günceller.
 */

const args = process.argv.slice(2).filter((a) => a !== '--');

function arg(ad: string): string | undefined {
  const i = args.indexOf(`--${ad}`);
  if (i === -1) return undefined;
  return args[i + 1];
}

function hata(mesaj: string): never {
  console.error(`\n  HATA: ${mesaj}\n`);
  console.error('  Kullanım: --role <id> --system <rol> --perms <liste|all> [--squad-group <ad>]');
  console.error(`  Sistem rolleri: ${SYSTEM_ROLES.join(', ')}`);
  console.error(`  İzinler: ${PERMISSIONS.join(', ')}\n`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) hata('DATABASE_URL tanımlı değil');

const roleId = arg('role');
// Discord kimlikleri 17-20 haneli sayı. Yanlış yapıştırılan bir değer
// sessizce kaydedilirse eşleme hiç tutmaz ve sebebi anlaşılmaz.
if (!roleId || !/^\d{17,20}$/.test(roleId)) hata('--role geçerli bir Discord rol kimliği olmalı');

const systemRole = arg('system');
if (!systemRole || !SYSTEM_ROLES.includes(systemRole as SystemRole)) {
  hata(`--system şunlardan biri olmalı: ${SYSTEM_ROLES.join(', ')}`);
}

const permsRaw = arg('perms');
if (!permsRaw) hata('--perms verilmeli ("all" ya da virgülle ayrılmış liste)');
const perms: Permission[] =
  permsRaw === 'all'
    ? [...PERMISSIONS]
    : permsRaw.split(',').map((p) => {
        const t = p.trim();
        if (!PERMISSIONS.includes(t as Permission)) hata(`bilinmeyen izin: ${t}`);
        return t as Permission;
      });

const squadGroup = arg('squad-group') ?? null;

const db = createDb(databaseUrl);

// Oyun içi grup verildiyse gerçekten var mı bakıyoruz: olmayan bir grup adı
// Admins.cfg'ye yazılır ve Squad o satırı sessizce yok sayar.
if (squadGroup) {
  const gruplar = await db.select({ name: squadAdminGroups.name }).from(squadAdminGroups);
  if (!gruplar.some((g) => g.name === squadGroup)) {
    hata(
      `'${squadGroup}' adında bir oyun grubu yok. Mevcut: ${gruplar.map((g) => g.name).join(', ')}`,
    );
  }
}

const [mevcut] = await db
  .select()
  .from(roleMappings)
  .where(eq(roleMappings.discordRoleId, roleId))
  .limit(1);

if (mevcut) {
  await db
    .update(roleMappings)
    .set({ systemRole, panelPermissions: perms, squadGroup })
    .where(eq(roleMappings.discordRoleId, roleId));
  console.log(`Güncellendi: ${roleId} -> ${systemRole}`);
} else {
  await db
    .insert(roleMappings)
    .values({ discordRoleId: roleId, systemRole, panelPermissions: perms, squadGroup });
  console.log(`Oluşturuldu: ${roleId} -> ${systemRole}`);
}
console.log(
  `  panel izinleri : ${perms.length === PERMISSIONS.length ? 'hepsi' : perms.join(', ')}`,
);
console.log(`  oyun grubu     : ${squadGroup ?? '(yok — oyun içi yetki vermez)'}`);

process.exit(0);
