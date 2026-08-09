/**
 * Squad RemoteAdminListHosts.cfg biçimi.
 *
 * Format canlı sunucudaki Admins.cfg'den alındı:
 *   Group=<ad>:<virgülle ayrılmış yetkiler>
 *   Admin=<SteamID veya EOS>:<grup adı> // yorum
 *
 * TEK KAYNAK Discord'dur (kullanıcı kararı, plan Bölüm 8): Discord'da admin
 * rolü olan oyunda admin olur, rol alınınca yetkisi düşer. Elle verilmiş
 * "manuel admin" yolu bilinçli olarak yok — iki paralel yetki mekanizması
 * eski sistemin en büyük hatasıydı.
 */

export interface AdminGroupDef {
  name: string;
  permissions: string;
}

export interface AdminEntry {
  steamId: string | null;
  eosId: string | null;
  groupName: string;
  /** Kim olduğu log/denetim için; oyuna yorum olarak gider. */
  label?: string | undefined;
}

export interface AdminListResult {
  body: string;
  /** Listeye giren benzersiz admin sayısı — emniyet kontrolü bunu kullanır. */
  adminCount: number;
}

export interface FormatAdminListOptions {
  groups: AdminGroupDef[];
  entries: AdminEntry[];
  now: Date;
  /** Discord rolleri en son ne zaman senkronlandı (bayatlık uyarısı için). */
  rolesSyncedAt?: Date | undefined;
}

/** Yorum satırını tek satıra indirger; kaçan bir \n dosyayı bozar. */
function sanitizeComment(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 60)
    .trim();
}

export function formatAdminList(opts: FormatAdminListOptions): AdminListResult {
  const { groups, entries, now, rolesSyncedAt } = opts;
  const lines: string[] = [];

  // Yalnızca gerçekten kullanılan grupları yaz — kullanılmayan grup tanımı
  // Squad tarafında zararsız ama dosyayı gereksiz büyütür ve okumayı zorlaştırır.
  const usedGroups = new Set(entries.map((e) => e.groupName));
  for (const g of groups) {
    if (!usedGroups.has(g.name)) continue;
    lines.push(`Group=${g.name}:${g.permissions}`);
  }
  lines.push('');

  const admins = new Set<string>();
  const seenLines = new Set<string>();
  for (const e of entries) {
    // Squad her iki kimlik biçimini de tanıyor. İkisi de varsa ikisini de
    // yazıyoruz: EOS değişmiş ya da eksikse yetki yine tanınsın.
    for (const id of [e.eosId, e.steamId]) {
      if (!id) continue;
      const line = `Admin=${id}:${e.groupName}`;
      if (seenLines.has(line)) continue;
      seenLines.add(line);
      lines.push(e.label ? `${line} // ${sanitizeComment(e.label)}` : line);
      admins.add(id);
    }
  }

  const stale =
    rolesSyncedAt && now.getTime() - rolesSyncedAt.getTime() > 24 * 3600 * 1000
      ? `UYARI: Discord rol senkronu bayat (${rolesSyncedAt.toISOString()})`
      : null;

  const header = [
    '//////////////////////////////////////////////////////////////////////',
    '//// Altai v2 — otomatik üretilmiş admin listesi. ELLE DÜZENLEMEYİN. ////',
    '//// Kaynak: Discord rolleri. Rol alınınca oyun içi yetki de düşer.',
    `//// ${admins.size} kimlik, ${usedGroups.size} grup`,
    `//// üretim: ${now.toISOString()}`,
    ...(rolesSyncedAt ? [`//// rol senkronu: ${rolesSyncedAt.toISOString()}`] : []),
    ...(stale ? [`//// ${stale}`] : []),
    '//////////////////////////////////////////////////////////////////////',
    '',
  ];

  return { body: `${[...header, ...lines].join('\n')}\n`, adminCount: admins.size };
}
