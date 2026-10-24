import { z } from 'zod';

// api -> agent yönünde giden komutlar. correlationId + timeout ile eşleşir.
export const AgentCommand = z.object({
  correlationId: z.string().uuid(),
  serverId: z.string(),
  // 'ping' oyuna DOKUNMAZ: agent RCON'a hiç gitmeden cevaplar. Kanalın
  // (api -> WS -> agent -> cevap) çalıştığını, canlı sunucuda bir eylem
  // yapmadan doğrulamak için var. Bu olmadan kanalı sınamanın tek yolu
  // gerçek bir oyuncuyu atmaktı.
  // 'listPlayers' o an sunucuda olan oyuncuları döndürür. Ban uygulaması
  // buna dayanıyor: api periyodik olarak listeyi isteyip ban'lıları atıyor.
  action: z.enum([
    'ping',
    'kick',
    'ban',
    'warn',
    'broadcast',
    'listPlayers',
    // Oyuncuyu karşı takıma alır (AdminForceTeamChange). Squad'da hedef
    // takım SEÇİLEMİYOR — komut yalnızca "diğer tarafa geçir" diyor.
    'forceTeamChange',
    // Harita: payload { layer, zaman: 'simdi' | 'sonraki' }.
    //   simdi   -> AdminChangeLayer  (maç o an biter)
    //   sonraki -> AdminSetNextLayer (maç bitince geçer)
    'setLayer',
    // Maçı baştan başlatır (AdminRestartMatch). Sunucu SÜRECİNİ değil:
    // onu barındırma sağlayıcısı yönetiyor ve RCON'dan kapatılırsa geri
    // açacak bir şey yok.
    'restart',
    // Oyuna dokunmayan sorgular: şu anki/sıradaki harita ve sunucunun
    // tanıdığı harita listesi. Panel listeden seçtiriyor; elle yazılan
    // bir yazım hatası AdminChangeLayer'da maçı boşuna bitirirdi.
    'mapInfo',
    'listLayers',
  ]),
  payload: z.record(z.unknown()),
  issuedBy: z.string(), // system role user id
});

export type AgentCommand = z.infer<typeof AgentCommand>;

export const AgentCommandResult = z.object({
  correlationId: z.string().uuid(),
  ok: z.boolean(),
  error: z.string().optional(),
  /** Komuta özel dönüş (örn. listPlayers'ın oyuncu listesi). */
  data: z.unknown().optional(),
});

/** listPlayers'ın döndürdüğü biçim. */
export const OnlinePlayer = z.object({
  steamId: z.string().nullable(),
  eosId: z.string().nullable(),
  name: z.string(),
  /** RCON ListPlayers'tan: takım 1/2, manga numarası, rol, manga lideri mi. */
  teamId: z.number().int().nullable(),
  squadId: z.number().int().nullable(),
  squadName: z.string().nullable(),
  role: z.string().nullable(),
  isLeader: z.boolean(),
});
export const OnlinePlayers = z.object({ players: z.array(OnlinePlayer) });

/**
 * Squad katman (layer) adı: `Narva_RAAS_v1`, `GooseBay_Seed_v1`.
 *
 * Harf, rakam, alt çizgi ve en az bir alt çizgi. RCON komutuna argüman
 * olarak gidiyor; boşluk ya da satır sonu ikinci bir komut enjekte ederdi.
 */
export const KATMAN_ADI = /^[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+$/;

/** mapInfo'nun döndürdüğü biçim. Bilinmeyen alan null. */
export const HaritaBilgisi = z.object({
  simdiki: z.object({ level: z.string().nullable(), layer: z.string().nullable() }),
  sonraki: z.object({ level: z.string().nullable(), layer: z.string().nullable() }),
});
export type HaritaBilgisi = z.infer<typeof HaritaBilgisi>;

/** listLayers'ın döndürdüğü biçim. */
export const KatmanListesi = z.object({ layers: z.array(z.string()) });
export type OnlinePlayer = z.infer<typeof OnlinePlayer>;
export type AgentCommandResult = z.infer<typeof AgentCommandResult>;
