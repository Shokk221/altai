// Tek yetki zinciri: Discord rolü -> sistem rolü -> bu izin enum'u.
// Hem web RBAC'ı hem Admins.cfg üretimi buradan beslenir.
export const PERMISSIONS = [
  'player.view',
  'player.ban',
  'player.warn',
  'player.kick',
  'player.note.write',
  'flag.manage',
  'admin_list.manage',
  'plugin_config.write',
  'clan.manage',
  'ticket.manage',
  'rules.manage',
  'server.control',
  // Sistem gunlugunu okuma. Ayri izin: gunluk kimin kime baktigini da
  // tutuyor, yani her moderatorun gormesi gereken bir sey degil.
  'audit.read',
  'super_admin',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLES = ['super_admin', 'admin', 'moderator', 'clan_leader', 'member'] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];
