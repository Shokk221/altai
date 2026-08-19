/**
 * Maç istatistiklerinin türetilmiş büyüklükleri (plan Faz 4).
 *
 * Ham sayılar `round_players`'da; buradakiler onlardan HESAPLANAN değerler.
 * Ayrı dosyada olmalarının sebebi test edilebilirlik: "hiç ölmemiş
 * oyuncunun K/D'si ne" sorusunun cevabı bir veritabanı gerektirmemeli, ama
 * yanlış cevabı sıralamanın tepesini bozar.
 */

export interface OyuncuIstatistigi {
  bulundu: boolean;
  rounds: number;
  kills: number;
  deaths: number;
  revives: number;
  teamkills: number;
  bestKillstreak: number;
  damageDealt: number;
  damageTaken: number;
  wins: number;
  losses: number;
  /** Türetilmiş: öldürme/ölüm oranı. */
  kdr: number;
  /** Türetilmiş: bilinen sonuçlar içindeki galibiyet yüzdesi (0-100). */
  winRate: number | null;
  /** En çok öldürme yapılan silahlar, çoktan aza. */
  topWeapons: Array<{ weapon: string; kills: number }>;
}

export interface SiralamaSatiri {
  playerId: string;
  steamId: string | null;
  name: string | null;
  rounds: number;
  kills: number;
  deaths: number;
  revives: number;
  kdr: number;
}

/**
 * Öldürme/ölüm oranı.
 *
 * Hiç ölmemiş oyuncuda bölme yapılmıyor, öldürme sayısı doğrudan oran
 * kabul ediliyor. Sıfıra bölmek Infinity üretirdi ve o değer JSON'da
 * `null`'a dönüşüp panelde boş görünürdü — oysa "5 öldürme, 0 ölüm"
 * gösterilecek bir başarı.
 *
 * İki basamağa yuvarlanıyor: 1.6666666666666667 gibi bir sayının oyuncuya
 * anlattığı şey 1.67'den fazla değil.
 */
export function kdOrani(kills: number, deaths: number): number {
  if (deaths <= 0) return Math.round(kills * 100) / 100;
  return Math.round((kills / deaths) * 100) / 100;
}

/**
 * Galibiyet yüzdesi — BİLİNEN sonuçlar üzerinden.
 *
 * `is_winner` null olan satırlar (beraberlik, kazananı bildirmeyen mod,
 * takımı çözülemeyen oyuncu) paydaya girmiyor. Onları kayıp saymak, bir
 * modun log davranışı yüzünden oyuncunun oranını düşürmek olurdu.
 *
 * Hiç bilinen sonuç yoksa `null` — sıfır yazmak "hep kaybetti" demekti.
 */
export function galibiyetOrani(wins: number, losses: number): number | null {
  const toplam = wins + losses;
  if (toplam <= 0) return null;
  return Math.round((wins / toplam) * 1000) / 10;
}

/**
 * Silah kırılımlarını tek listede toplar.
 *
 * Girdi maç başına bir sözlük; oyuncunun bütün maçları toplanıp çoktan aza
 * sıralanıyor. Eşitlikte silah adına göre sıralanıyor ki aynı veri her
 * çağrıda aynı sırayla dönsün — sırası oynayan bir liste, panelde her
 * yenilemede farklı görünürdü.
 */
export function silahlariTopla(
  kayitlar: Array<Record<string, number> | null | undefined>,
  limit = 3,
): Array<{ weapon: string; kills: number }> {
  const toplam = new Map<string, number>();
  for (const kayit of kayitlar) {
    if (!kayit) continue;
    for (const [silah, adet] of Object.entries(kayit)) {
      if (!Number.isFinite(adet) || adet <= 0) continue;
      toplam.set(silah, (toplam.get(silah) ?? 0) + adet);
    }
  }
  return [...toplam.entries()]
    .map(([weapon, kills]) => ({ weapon, kills }))
    .sort((a, b) => b.kills - a.kills || a.weapon.localeCompare(b.weapon))
    .slice(0, limit);
}

/** Hiç maçı olmayan oyuncunun cevabı. Sıfırlarla dolu, `bulundu: false`. */
export function bosIstatistik(): OyuncuIstatistigi {
  return {
    bulundu: false,
    rounds: 0,
    kills: 0,
    deaths: 0,
    revives: 0,
    teamkills: 0,
    bestKillstreak: 0,
    damageDealt: 0,
    damageTaken: 0,
    wins: 0,
    losses: 0,
    kdr: 0,
    winRate: null,
    topWeapons: [],
  };
}

/**
 * Oyuncuya oyun içinde gösterilecek tek satırlık özet.
 *
 * Squad'ın uyarı kutusu kısa ve tek satır; buraya sığmayan her şey
 * kesiliyor. Bu yüzden sıra önemli: oyuncunun sorduğu şey önce K/D, sonra
 * öldürme, sonra canlandırma. Maç sayısı sonda çünkü "kaç maç oynadım"
 * merakı en az olan.
 */
export function oyunIciOzet(ist: OyuncuIstatistigi): string {
  if (!ist.bulundu || ist.rounds === 0) {
    return 'Henüz kayıtlı maçın yok — bir maç tamamlayınca istatistiğin oluşur.';
  }
  const parcalar = [
    `K/D ${ist.kdr}`,
    `${ist.kills} öldürme`,
    `${ist.deaths} ölüm`,
    `${ist.revives} canlandırma`,
  ];
  if (ist.bestKillstreak > 0) parcalar.push(`en uzun seri ${ist.bestKillstreak}`);
  if (ist.winRate !== null) parcalar.push(`%${ist.winRate} galibiyet`);
  parcalar.push(`${ist.rounds} maç`);
  return parcalar.join(' | ');
}
