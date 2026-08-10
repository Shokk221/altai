import type { ActivityCategory, Db } from '@altai/db';
import { moderationSchema } from '@altai/db';
import { anlamliIsaretle, kaydetTx } from './activity-log.js';

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
  | 'role_mapping.delete'
  /** Canlı ekrandan yapılan, kalıcı kayıt bırakmayan eylemler. */
  | 'player.kick'
  | 'player.warn';

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
  /**
   * Eylem anındaki görünen ad. Denormal: kullanıcı Discord adını
   * değiştirse bile kayıt o günkü hâliyle okunmalı.
   */
  actorLabel?: string | null;
  /** UUID'si olmayan hedefler (SteamID, sunucu slug'ı, Discord rol id'si). */
  targetLabel?: string | null;
  /** Aynı isteğin genel http satırıyla bağ kurar (Fastify req.id). */
  requestId?: string | null;
}

/** Transaction handle'ı: db.transaction(async (tx) => ...) içindeki `tx`. */
type TxLike = Pick<Db, 'insert'>;

/**
 * Eylemin sistem günlüğündeki kırılımı.
 *
 * Rol eşlemeleri moderasyon değil erişim konusu: "kim ban attı" ile "kim
 * kime yetki verdi" ayrı sorular ve ekranda ayrı sekmelerde aranıyorlar.
 */
function kategori(action: AuditAction): ActivityCategory {
  return action.startsWith('role_mapping.') ? 'erisim' : 'moderasyon';
}

/**
 * Denetim kaydını İKİ yere birden yazar, ikisi de çağıranın transaction'ı
 * içinde:
 *
 *   moderation_audit -> dar ve kalıcı; "bu ban kimin kararı"nın kaynağı.
 *   activity_log     -> geniş ve akış hâlinde; tek ekranda her şeyi görmek.
 *
 * Aynası olmasaydı moderasyon eylemleri sistem günlüğünde yalnızca
 * "POST /api/moderation/bans" satırı olarak görünürdü — kimin banlandığı,
 * ne kadar süreyle, hangi sebeple hiçbiri okunamazdı.
 */
export async function writeAudit(tx: TxLike, entry: AuditEntry) {
  await tx.insert(moderationSchema.moderationAudit).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    payload: entry.payload ?? null,
  });

  if (entry.requestId) anlamliIsaretle(entry.requestId);

  await kaydetTx(tx, {
    actorType: entry.actorUserId ? 'user' : 'system',
    actorUserId: entry.actorUserId,
    actorLabel: entry.actorLabel ?? null,
    action: entry.action,
    category: kategori(entry.action),
    targetType: entry.targetType,
    targetId: entry.targetId,
    targetLabel: entry.targetLabel ?? null,
    payload: entry.payload ?? null,
    requestId: entry.requestId ?? null,
  });
}
