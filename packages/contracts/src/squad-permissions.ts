// Squad'ın Admins.cfg erişim seviyeleri — OYUN içi yetki.
//
// Panel izinleriyle (permissions.ts) karıştırılmasın: bunlar oyunun kendi
// anahtar kelimeleri, `Group=<ad>:<virgüllü liste>` satırına aynen yazılıyor
// ve Squad tanımadığı bir kelimeyi SESSİZCE yok sayıyor. Bu yüzden serbest
// metin değil, bu listeden seçiliyor.
//
// `startvote` bilerek yok: Squad belgesinde "kullanılmıyor" diye geçiyor.
export const SQUAD_PERMISSIONS = [
  'changemap',
  'pause',
  'cheat',
  'private',
  'balance',
  'chat',
  'kick',
  'ban',
  'config',
  'cameraman',
  'immune',
  'manageserver',
  'featuretest',
  'reserve',
  'demos',
  'clientdemos',
  'debug',
  'teamchange',
  'forceteamchange',
  'canseeadminchat',
] as const;

export type SquadPermission = (typeof SQUAD_PERMISSIONS)[number];

// Yalnızca rezerve slot verir; oyunu yönetme yetkisi değildir. Bunun
// dışındaki her seviye yetkilidir ve Discord rolüne bağlı olmak zorundadır
// (tools/mongo-import'taki içe aktarma kuralıyla aynı).
export const ZARARSIZ_SQUAD_IZINLERI: readonly SquadPermission[] = ['reserve'];

/** Grup yalnızca zararsız seviyeler mi veriyor (whitelist mi)? */
export function yalnizcaWhitelistMi(izinler: readonly string[]): boolean {
  return izinler.every((p) => (ZARARSIZ_SQUAD_IZINLERI as readonly string[]).includes(p));
}
