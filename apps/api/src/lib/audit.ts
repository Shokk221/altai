import type { Db } from '@altai/db';
import { moderationSchema } from '@altai/db';

/**
 * Moderasyon denetim kaydı — plan Bölüm 4.4 "moderasyon audit log".
 *
 * Kural: HER yazma eylemi, eylemin kendisiyle AYNI transaction içinde
 * denetime yazılır. Ayrı yazılsaydı ban başarılı olup denetim kaydı düşerse
 * "bu banı kim attı" sorusunun cevabı kaybolurdu — ve tam da anlaşmazlık
 * çıktığında bu soru soruluyor.
 *
 * Bu yüzden `tx` parametresi zorunlu: çağıran taraf transaction açmaya
 * mecbur kalsın, unutup dışarıda bırakamasın.
 */
export type AuditAction =
  | 'ban.create'
  | 'ban.revoke'
  | 'record.create'
  | 'record.resolve'
  | 'flag.assign'
  | 'flag.remove'
  | 'role_mapping.upsert'
  | 'role_mapping.delete';

export type AuditTargetType =
  | 'player'
  | 'ban'
  | 'player_record'
  | 'flag_assignment'
  | 'role_mapping';

export interface AuditEntry {
  actorUserId: string | null;
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string | null;
  /** Eylemin öncesi/sonrası veya girdinin kendisi. */
  payload?: Record<string, unknown>;
}

/** Transaction handle'ı: db.transaction(async (tx) => ...) içindeki `tx`. */
type TxLike = Pick<Db, 'insert'>;

export async function writeAudit(tx: TxLike, entry: AuditEntry) {
  await tx.insert(moderationSchema.moderationAudit).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    payload: entry.payload ?? null,
  });
}
