/**
 * mongoexport çıktısının ayrıştırma yardımcıları.
 *
 * Ayrı modülde: bunlar saf fonksiyonlar ve veritabanı olmadan test
 * edilebilirler. İlk sürümde extended JSON tanınmadığı için 5.698 admin
 * cam kaydı sessizce elenmişti — bu biçimler artık testle kilitli.
 */

/** Bir kimlik dizesinin EOS mi Steam mi olduğunu biçiminden anlar. */
export function classifyId(raw: unknown): { steamId?: string; eosId?: string } {
  if (typeof raw !== 'string') return {};
  const v = raw.trim();
  if (/^7656119\d{10}$/.test(v)) return { steamId: v };
  if (/^[0-9a-f]{32}$/i.test(v)) return { eosId: v.toLowerCase() };
  return {};
}

/**
 * mongoexport "extended JSON" yazıyor: tarihler {"$date": "..."} nesnesi
 * olarak geliyor, düz string değil. Bunu tanımamak sessiz veri bozulmasına
 * yol açıyordu — admin cam kayıtlarının tamamı elenmiş, grant ve link
 * kayıtları ise gerçek tarih yerine "şimdi" ile yazılacaktı.
 */
export function toDate(v: unknown): Date | undefined {
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? undefined : new Date(ms);
  }
  if (typeof v === 'number') return new Date(v);
  if (v && typeof v === 'object' && '$date' in v) {
    return toDate((v as { $date: unknown }).$date);
  }
  return undefined;
}

/** mongoexport _id'yi {"$oid": "..."} olarak yazar. */
export function docId(doc: Record<string, unknown>): string {
  const id = doc._id;
  if (typeof id === 'string') return id;
  if (id && typeof id === 'object' && '$oid' in id) return String((id as { $oid: string }).$oid);
  return JSON.stringify(id);
}
