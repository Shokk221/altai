import { randomUUID } from 'node:crypto';
import type { AgentCommand, AgentCommandResult } from '@altai/contracts';
import { logger } from '@altai/shared';

/**
 * api -> agent komut kanalı.
 *
 * Protokol zaten vardı (contracts/agent-commands.ts) ama iki ucu da boştu:
 * api komut gönderemiyor, agent geleni sadece logluyordu. Ban atıldığında
 * oyuncu oyunda kalmaya devam ediyordu.
 *
 * TASARIM KARARI — komut başarısız olursa moderasyon eylemi İPTAL EDİLMEZ.
 * Agent kopuk olabilir, RCON yanıt vermiyor olabilir. Ban veritabanına
 * yazıldıysa oyuncu bir sonraki girişinde remote ban list tarafından zaten
 * engellenir; anında atma bunun üstüne bir hızlandırmadır, önkoşulu değil.
 * Tersini yapmak (agent kopukken ban atmayı reddetmek) moderasyonu oyun
 * sunucusunun sağlığına bağımlı kılardı.
 */

const KOMUT_ZAMAN_ASIMI_MS = 10_000;

interface BagliAgent {
  send(data: string): void;
}

interface BekleyenKomut {
  cozumle(result: AgentCommandResult): void;
  zamanlayici: ReturnType<typeof setTimeout>;
}

const agentlar = new Map<string, BagliAgent>();
const bekleyen = new Map<string, BekleyenKomut>();

export function agentBaglandi(serverSlug: string, agent: BagliAgent) {
  agentlar.set(serverSlug, agent);
}

export function agentKoptu(serverSlug: string) {
  agentlar.delete(serverSlug);
}

export function agentBagliMi(serverSlug: string): boolean {
  return agentlar.has(serverSlug);
}

/** Bağlı agent'ların slug listesi — ayar itişi kime gideceğini bundan bulur. */
export function bagliAgentlar(): string[] {
  return [...agentlar.keys()];
}

/**
 * Cevap beklemeden mesaj gönderir.
 *
 * Plugin ayarları için: `komutGonder` correlationId ile cevap bekliyor ve
 * zaman aşımı tutuyor, ayar itişinde ikisi de gereksiz. Agent kopuksa da
 * sorun değil — bağlandığında ayarları hello_ack'in ardından zaten alıyor.
 */
export function agentaGonder(serverSlug: string, message: unknown): boolean {
  const agent = agentlar.get(serverSlug);
  if (!agent) return false;
  try {
    agent.send(JSON.stringify(message));
    return true;
  } catch (err) {
    logger.error({ err, serverSlug }, 'agenta mesaj gönderilemedi');
    return false;
  }
}

/** agent-ws, command_result geldiğinde bunu çağırır. */
export function komutSonucuGeldi(result: AgentCommandResult) {
  const kayit = bekleyen.get(result.correlationId);
  if (!kayit) {
    // Zaman aşımına uğramış bir komutun geç gelen cevabı olabilir.
    logger.warn({ correlationId: result.correlationId }, 'eşleşmeyen komut sonucu');
    return;
  }
  clearTimeout(kayit.zamanlayici);
  bekleyen.delete(result.correlationId);
  kayit.cozumle(result);
}

export type KomutSonucu =
  // `data` yalnızca veri döndüren komutlarda dolu (örn. listPlayers).
  | { durum: 'ok'; data?: unknown }
  | { durum: 'agent_yok' }
  | { durum: 'zaman_asimi' }
  | { durum: 'hata'; mesaj: string };

/**
 * Komut, bağlı sunuculardan en az birinde gerçekten çalıştı mı?
 *
 * Komut bütün sunuculara gönderiliyor çünkü oyuncunun hangisinde olduğunu
 * bilmiyoruz; oyuncunun bulunmadığı sunucular da 'ok' döner (RCON zararsız
 * bir "bulunamadı" verir). Yani bu, "oyuncu komutu gördü" değil, "komut
 * kanalı uçtan uca çalıştı" demek — uyarının `delivered_at`'i buna bakıyor.
 *
 * Girdi bilerek `Record<string, string>`: çağıran taraf 'hata' durumunu
 * mesajıyla birlikte tek dizeye indirgiyor ('hata: ...'), yalnızca tam
 * 'ok' eşleşmesi başarı sayılır.
 */
export function komutUlasti(sonuclar: Record<string, string>): boolean {
  return Object.values(sonuclar).some((durum) => durum === 'ok');
}

/**
 * Komutu gönderir ve agent'ın cevabını bekler.
 *
 * Hiçbir durumda throw etmez: çağıran taraf moderasyon eylemini bu sonuca
 * göre iptal etmemeli, yalnızca kullanıcıya bildirmeli.
 */
export async function komutGonder(
  serverSlug: string,
  action: AgentCommand['action'],
  payload: Record<string, unknown>,
  issuedBy: string,
): Promise<KomutSonucu> {
  const agent = agentlar.get(serverSlug);
  if (!agent) return { durum: 'agent_yok' };

  const correlationId = randomUUID();
  const command: AgentCommand = { correlationId, serverId: serverSlug, action, payload, issuedBy };

  return new Promise<KomutSonucu>((resolve) => {
    const zamanlayici = setTimeout(() => {
      bekleyen.delete(correlationId);
      logger.warn({ serverSlug, action, correlationId }, 'komut zaman aşımına uğradı');
      resolve({ durum: 'zaman_asimi' });
    }, KOMUT_ZAMAN_ASIMI_MS);

    bekleyen.set(correlationId, {
      zamanlayici,
      cozumle: (result) => {
        if (result.ok) resolve({ durum: 'ok', data: result.data });
        else resolve({ durum: 'hata', mesaj: result.error ?? 'bilinmeyen hata' });
      },
    });

    try {
      agent.send(JSON.stringify({ type: 'command', command }));
    } catch (err) {
      clearTimeout(zamanlayici);
      bekleyen.delete(correlationId);
      logger.error({ err, serverSlug, action }, 'komut gönderilemedi');
      resolve({ durum: 'hata', mesaj: 'gönderilemedi' });
    }
  });
}
