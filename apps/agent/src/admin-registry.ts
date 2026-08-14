import type { AdminIdentity } from '@altai/contracts';

/**
 * Agent'ın bellekteki oyun içi yetki listesi.
 *
 * Vendored SquadJS'in `server.admins`'i boş bir stub (Mongo bağımlılığı
 * kaldırılırken öyle bırakıldı). Bu yüzden plugin'lerin "admini muaf tut"
 * kontrolü hiç çalışmıyordu — sessizce, her zaman "admin değil" diyordu.
 *
 * Liste api'den uplink üzerinden geliyor ve Admins.cfg'yi üreten sorgunun
 * ta kendisinden besleniyor: oyun içi yetki ile plugin muafiyeti aynı
 * kaynaktan geldiği için ayrışamazlar.
 */

/**
 * "Gerçek admin" sayılan Squad yetkileri.
 *
 * Eski plugin'lerin dördü de (name-enforcer, seed-tracker,
 * playtime-squad-guard, sl-kit-enforcer) aynı listeyi kullanıyordu; buraya
 * tek kopya olarak alındı.
 *
 * `reserve` BİLEREK yok: rezerve slot whitelist üyeliğidir, yetki değil.
 * İkisini karıştırmak "bağışçı olduğu için kicklenmedi" demek olurdu.
 */
const GERCEK_ADMIN_YETKILERI = [
  'cameraman',
  'canseeadminchat',
  'kick',
  'ban',
  'changemap',
  'balance',
  'forceteamchange',
  'chat',
];

export class AdminRegistry {
  /** steam/eos kimliği -> yetki dizesi. İki kimlik de aynı kayda işaret eder. */
  private yetkiler = new Map<string, string>();
  /**
   * steam/eos kimliği -> grup adı (SuperAdmin, HeadAdmin, Admin, KlanWL...).
   *
   * Yetkiden AYRI tutuluyor çünkü ikisi farklı soruların cevabı: "bu kişi
   * oyuncu atabilir mi" bir yetki sorusu, "bu kişi kıdemli admin mi" bir
   * grup sorusu. Sis savaşı gibi ağır komutlar ikincisine bakıyor —
   * `kick` yetkisi olan herkesin haritayı karartabilmesi istenmiyor.
   */
  private gruplar = new Map<string, string>();
  private geldiMi = false;

  /** api'den gelen tam listeyi uygular. */
  guncelle(admins: AdminIdentity[]): void {
    const yeni = new Map<string, string>();
    const yeniGrup = new Map<string, string>();
    for (const a of admins) {
      // Aynı oyuncu iki kimlikle de aranabiliyor; ikisini de indeksliyoruz.
      if (a.steamId) {
        yeni.set(a.steamId, a.permissions);
        yeniGrup.set(a.steamId, a.groupName);
      }
      if (a.eosId) {
        yeni.set(a.eosId.toLowerCase(), a.permissions);
        yeniGrup.set(a.eosId.toLowerCase(), a.groupName);
      }
    }
    this.yetkiler = yeni;
    this.gruplar = yeniGrup;
    this.geldiMi = true;
  }

  /** Liste api'den hiç gelmedi mi? Plugin'ler buna göre uyarabilir. */
  bosMu(): boolean {
    return !this.geldiMi;
  }

  boyut(): number {
    return this.yetkiler.size;
  }

  adminYetkileri(steamId?: string | null, eosId?: string | null): string | null {
    if (steamId) {
      const y = this.yetkiler.get(steamId);
      if (y !== undefined) return y;
    }
    if (eosId) {
      const y = this.yetkiler.get(eosId.toLowerCase());
      if (y !== undefined) return y;
    }
    return null;
  }

  /** Oyuncunun Admins.cfg grubu. Listede yoksa null. */
  grup(steamId?: string | null, eosId?: string | null): string | null {
    if (steamId) {
      const g = this.gruplar.get(steamId);
      if (g !== undefined) return g;
    }
    if (eosId) {
      const g = this.gruplar.get(eosId.toLowerCase());
      if (g !== undefined) return g;
    }
    return null;
  }

  gercekAdminMi(steamId?: string | null, eosId?: string | null): boolean {
    const ham = this.adminYetkileri(steamId, eosId);
    if (ham === null) return false;
    // Squad'ın yazımı virgülle ayrılmış ve boşluk içerebiliyor.
    const sahip = new Set(
      ham
        .split(',')
        .map((p) => p.trim().toLowerCase())
        .filter(Boolean),
    );
    return GERCEK_ADMIN_YETKILERI.some((p) => sahip.has(p));
  }
}
