import type {
  SquadJSOnlinePlayer,
  SquadJSPlayer,
  SquadJSPlayerDamagedRaw,
  SquadJSPlayerDiedRaw,
  SquadJSPlayerRevivedRaw,
} from './engine.js';

/**
 * Maç içi skorbord biriktiricisi (plan Faz 4).
 *
 * Ölüm/canlandırma/hasar olayları BELLEKTE toplanıyor, maç bittiğinde tek
 * bir satır listesi çıkıyor. Sebep basit: bir maçta on binlerce hasar ve
 * binlerce ölüm olayı var; her birini uplink'ten geçirip `raw_events`'e
 * yazmak, taşıdıkları bilgi zaten toplamdan ibaretken devasa bir tablo
 * üretirdi. Skorbord tam olarak o toplam.
 *
 * Motoru HİÇ BİLMİYOR: yalnızca ham olay şekillerini alıyor. Böylece "TK
 * öldürme sayılmamalı" ya da "killstreak ölünce sıfırlanır" gibi kararlar
 * bir Squad sunucusu olmadan test edilebiliyor.
 *
 * KİMLİK: satırlar EOS kimliğiyle anahtarlanıyor, SteamID ile değil. Squad
 * oyuncuyu artık EOS ile tanıyor ve RCON listesinde SteamID'si hiç
 * görünmeyen oyuncular var; SteamID'yi anahtar yapmak o oyuncuların tüm
 * maçını çöpe atardı. SteamID satıra yine yazılıyor (varsa), yalnızca
 * anahtar değil.
 */

export interface SkorbordSatiri {
  steamId: string | null;
  eosId: string | null;
  name: string | null;
  teamId: number | null;
  squadId: number | null;
  role: string | null;
  isLeader: boolean | null;
  kills: number;
  deaths: number;
  revives: number;
  teamkills: number;
  /** Maç boyunca ölmeden yapılan en uzun öldürme serisi. */
  killstreak: number;
  damageDealt: number;
  damageTaken: number;
  /** Silah adı -> öldürme sayısı. Silahsız (çevre/araç) ölümler dışarıda. */
  weapons: Record<string, number>;
}

export interface SkorbordOzeti {
  satirlar: SkorbordSatiri[];
  /** Kimliği çözülemediği için hiçbir satıra yazılamayan ölüm sayısı. */
  atlananOlum: number;
}

interface Kayit extends SkorbordSatiri {
  /** Şu anki (henüz kırılmamış) seri — `killstreak` bunun gördüğü en büyük değer. */
  aktifSeri: number;
}

/** Bir oyuncunun anahtarı: EOS varsa o, yoksa SteamID. İkisi de yoksa null. */
function anahtar(p: SquadJSPlayer | null | undefined): string | null {
  if (!p) return null;
  const eos = p.eosID?.trim();
  if (eos) return `eos:${eos}`;
  const steam = p.steamID?.trim();
  return steam ? `steam:${steam}` : null;
}

function sayiya(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface MacSkorbordu {
  olum(raw: SquadJSPlayerDiedRaw): void;
  canlandirma(raw: SquadJSPlayerRevivedRaw): void;
  hasar(raw: SquadJSPlayerDamagedRaw): void;
  /**
   * Maçı kapatır ve satırları döndürür. SENKRON ve argümansız.
   *
   * Çevrimiçi oyuncu listesiyle zenginleştirme bilerek AYRI bir saf
   * fonksiyonda (`satirlariTazele`): liste RCON'dan geliyor, yani await
   * gerektiriyor ve o await sırasında NEW_GAME düşerse skorbord sıfırlanıp
   * maç tamamen kaybolurdu. Önce senkron kapat, sonra zenginleştir.
   */
  bitir(): SkorbordOzeti;
  sifirla(): void;
}

/**
 * Satırları maç sonundaki çevrimiçi oyuncu listesiyle tazeler.
 *
 * Takım/manga/rol maç boyunca değişiyor ve skorbordun "bu oyuncu hangi
 * takımdaydı" cevabı maçın SONUNDAKİ durum olmalı — kazanan/kaybeden
 * ayrımı buna dayanıyor. Maç bitmeden çıkanlar listede olmadığı için
 * onlarda son görülen değer kalıyor.
 *
 * Listede olup skorbordda hiç geçmeyen oyuncu SIFIR satırıyla ekleniyor:
 * maçı baştan sona oynayıp hiç öldürmemiş bir oyuncunun skorbordda
 * bulunmaması, o maça katılmadığı anlamına gelirdi.
 */
export function satirlariTazele(
  satirlar: SkorbordSatiri[],
  cevrimici: SquadJSOnlinePlayer[],
): SkorbordSatiri[] {
  const indeks = new Map<string, SkorbordSatiri>();
  for (const s of satirlar) {
    if (s.eosId) indeks.set(`eos:${s.eosId}`, s);
    if (s.steamId) indeks.set(`steam:${s.steamId}`, s);
  }

  const sonuc = [...satirlar];
  for (const p of cevrimici) {
    const k = p.eosId ? `eos:${p.eosId}` : p.steamId ? `steam:${p.steamId}` : null;
    if (!k) continue;
    let satir = indeks.get(k);
    if (!satir) {
      satir = {
        steamId: p.steamId,
        eosId: p.eosId,
        name: p.name || null,
        teamId: null,
        squadId: null,
        role: null,
        isLeader: null,
        kills: 0,
        deaths: 0,
        revives: 0,
        teamkills: 0,
        killstreak: 0,
        damageDealt: 0,
        damageTaken: 0,
        weapons: {},
      };
      sonuc.push(satir);
      if (p.eosId) indeks.set(`eos:${p.eosId}`, satir);
      if (p.steamId) indeks.set(`steam:${p.steamId}`, satir);
    }
    satir.teamId = p.teamId;
    satir.squadId = p.squadId;
    satir.role = p.role;
    satir.isLeader = p.isLeader;
    if (p.name) satir.name = p.name;
    if (p.steamId) satir.steamId = p.steamId;
    if (p.eosId) satir.eosId = p.eosId;
  }
  return sonuc;
}

export function macSkorborduOlustur(): MacSkorbordu {
  let kayitlar = new Map<string, Kayit>();
  let atlananOlum = 0;

  function bul(p: SquadJSPlayer | null | undefined): Kayit | null {
    const k = anahtar(p);
    if (!k || !p) return null;
    const mevcut = kayitlar.get(k);
    if (mevcut) {
      // Kimlik alanları maç boyunca dolabiliyor: oyuncu ilk görüldüğünde
      // RCON listesi henüz SteamID'sini bilmiyor olabilir. Sonradan gelen
      // bilgiyi yazıyoruz ama VARSA ÜZERİNE YAZMIYORUZ — sonradan gelen
      // boş bir alan, dolu olanı silmemeli.
      if (!mevcut.steamId && p.steamID) mevcut.steamId = p.steamID;
      if (!mevcut.eosId && p.eosID) mevcut.eosId = p.eosID;
      if (p.name) mevcut.name = p.name;
      const takim = sayiya(p.teamID);
      if (takim !== null) mevcut.teamId = takim;
      return mevcut;
    }
    const yeni: Kayit = {
      steamId: p.steamID ?? null,
      eosId: p.eosID ?? null,
      name: p.name ?? null,
      teamId: sayiya(p.teamID),
      squadId: sayiya(p.squadID),
      role: p.role ?? null,
      isLeader: p.isLeader ?? null,
      kills: 0,
      deaths: 0,
      revives: 0,
      teamkills: 0,
      killstreak: 0,
      damageDealt: 0,
      damageTaken: 0,
      weapons: {},
      aktifSeri: 0,
    };
    kayitlar.set(k, yeni);
    return yeni;
  }

  return {
    olum(raw) {
      const kurban = bul(raw.victim);
      const saldiran = bul(raw.attacker);

      // İki taraf da çözülemediyse olayın kimseye yazılacak yanı yok.
      // Sayıyoruz: skorbordun ne kadarını kaçırdığımız görünür olmalı,
      // sessizce yutmak "istatistik eksik mi" sorusunu cevapsız bırakırdı.
      if (!kurban && !saldiran) {
        atlananOlum++;
        return;
      }

      if (kurban) {
        kurban.deaths++;
        // Seri ÖLÜNCE kırılıyor — Squad'da killstreak'in anlamı bu.
        kurban.aktifSeri = 0;
      }

      if (!saldiran) return;
      // Kendini öldürme (intihar / çevre hasarı) ne kill ne TK: fork aynı
      // kişiyi hem kurban hem saldıran olarak verebiliyor ve bunu kill
      // saymak, patlayıcıyla ölen oyuncuya puan yazmak olurdu.
      if (kurban && saldiran === kurban) return;

      if (raw.teamkill === true) {
        saldiran.teamkills++;
        // TK öldürme sayılmıyor ve seriyi de büyütmüyor. Aksi halde takım
        // arkadaşlarını biçen oyuncu skorbordun tepesine çıkardı.
        return;
      }
      // `teamkill` undefined ise (fork iki tarafı çözemediğinde olur) normal
      // öldürme kabul ediliyor: bilinmeyeni TK saymak, temiz oynayan
      // oyuncuları haksız yere TK listesine sokardı. Yanılma bu yönde daha ucuz.
      saldiran.kills++;
      saldiran.aktifSeri++;
      if (saldiran.aktifSeri > saldiran.killstreak) saldiran.killstreak = saldiran.aktifSeri;

      const silah = raw.weapon?.trim();
      if (silah) saldiran.weapons[silah] = (saldiran.weapons[silah] ?? 0) + 1;
    },

    canlandirma(raw) {
      const canlandiran = bul(raw.reviver);
      if (canlandiran) canlandiran.revives++;
      // Canlandırılan kişi de skorborda giriyor: hiç öldürmemiş ama maçta
      // olmuş bir oyuncunun satırı olmalı, yoksa maç sonunda listede yok.
      bul(raw.victim);
    },

    hasar(raw) {
      const miktar = raw.damage;
      if (typeof miktar !== 'number' || !Number.isFinite(miktar) || miktar <= 0) return;
      const kurban = bul(raw.victim);
      const saldiran = bul(raw.attacker);
      if (kurban) kurban.damageTaken += miktar;
      // Kendine verilen hasar "verilen hasar" sayılmıyor — aynı sebeple.
      if (saldiran && saldiran !== kurban) saldiran.damageDealt += miktar;
    },

    bitir() {
      const satirlar = [...kayitlar.values()].map(({ aktifSeri: _atilan, ...satir }) => ({
        ...satir,
        // Hasar oyunda ondalıklı geliyor; kolon integer ve yarım hasarın
        // kimseye anlattığı bir şey yok.
        damageDealt: Math.round(satir.damageDealt),
        damageTaken: Math.round(satir.damageTaken),
      }));
      const ozet: SkorbordOzeti = { satirlar, atlananOlum };
      kayitlar = new Map();
      atlananOlum = 0;
      return ozet;
    },

    sifirla() {
      kayitlar = new Map();
      atlananOlum = 0;
    },
  };
}
