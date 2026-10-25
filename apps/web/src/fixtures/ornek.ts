/**
 * Tasarım önizlemesi için örnek veri.
 *
 * NEDEN VAR: panel api + Postgres + Discord oturumu olmadan açılmıyor, yani
 * tasarıma bakmak için bütün yığını ayağa kaldırmak gerekiyordu. Buradaki
 * veri `/tasarim` rotalarını besliyor; o rotalar da sayfaların GERÇEK
 * bileşenlerini basıyor. Böylece tasarım tarayıcıda ölçülebiliyor.
 *
 * KURAL: sayılar birbirini tutmak zorunda. Toplamlar satırlardan
 * hesaplanıyor, elle yazılmıyor; tutmayan bir sayı ekranın tamamına olan
 * güveni götürüyor. Dosyanın sonundaki doğrulamalar bunu derlemede değil,
 * önizleme açılırken konsola yazarak kontrol ediyor.
 *
 * Veri gerçekçi: Squad sunucusunda bir moderatörün göreceği büyüklükler.
 * 3.901 mesajlı oyuncu gerçek; burada ilk sayfası duruyor.
 */

import type { Flag } from '@/components/oyuncu/tipler';

/** Önizleme sabit görünsün diye tek bir "şimdi": her açılışta kaymıyor. */
export const SIMDI = new Date('2026-10-24T21:40:00+03:00');

const gun = 86_400_000;
const saat = 3_600_000;

/** Geçmişe dönük tarih üretir — örnek veri her gün taze görünüyor. */
function once(ms: number): string {
  return new Date(SIMDI.getTime() - ms).toISOString();
}

function sonra(ms: number): string {
  return new Date(SIMDI.getTime() + ms).toISOString();
}

// ---------------------------------------------------------------- oyuncu

const MAC_GALIBIYET = 34;
const MAC_MAGLUBIYET = 27;
const KILL = 1_284;
const OLUM = 698;

export const ORNEK_OYUNCU = {
  player: {
    id: 'p-8f3a21',
    steamId: '76561198042318855',
    eosId: '0002a1b9c4d7e8f0a1b2c3d4e5f60718',
    battlemetricsId: '1043872',
    name: 'Bozkurt',
  },
  names: [
    { name: 'Bozkurt', firstSeen: once(214 * gun), lastSeen: once(2 * gun) },
    { name: '[ALT] Bozkurt', firstSeen: once(168 * gun), lastSeen: once(41 * gun) },
    { name: 'Kurt_57', firstSeen: once(402 * gun), lastSeen: once(221 * gun) },
  ],
  bans: [
    {
      id: 'b-4471',
      reason: 'Takım arkadaşlarını kasten öldürdü, mangayı dağıttı. Bitiş: {{expires}}',
      internalNote: 'Üçüncü TK uyarısından sonra. Kayıtlarda iki açık uyarı vardı.',
      expiresAt: sonra(9 * gun + 4 * saat),
      revokedAt: null,
      issuedByName: 'Yalnızkurt',
      createdAt: once(5 * gun - 4 * saat),
      source: 'altai',
      active: true,
    },
    {
      id: 'b-3118',
      reason: 'Admin sohbetinde küfür. Kalan süre: {{timeLeft}}',
      internalNote: null,
      expiresAt: once(96 * gun),
      revokedAt: null,
      issuedByName: 'Demirci',
      createdAt: once(99 * gun),
      source: 'altai',
      active: false,
    },
    {
      id: 'b-1902',
      reason: 'Mayın tarlasına takım aracı sürdü',
      internalNote: null,
      expiresAt: null,
      revokedAt: once(305 * gun),
      issuedByName: 'Demirci',
      createdAt: once(312 * gun),
      source: 'battlemetrics',
      active: false,
    },
  ],
  flags: [
    {
      id: 'fa-61',
      flagId: 'f-tk',
      name: 'TK eğilimi',
      color: '#d9a441',
      addedAt: once(23 * gun),
      removedAt: null,
      expiresAt: null,
      reason: null,
      active: true,
    },
    {
      id: 'fa-44',
      flagId: 'f-takip',
      name: 'Takipte',
      color: '#4a8ad6',
      addedAt: once(5 * gun),
      removedAt: null,
      // Süreli etiket örneği: SL ban demo'da da görünsün.
      expiresAt: sonra(4 * gun),
      reason: 'SL-6 · Aktif objektiflere oynamama',
      active: true,
    },
    {
      id: 'fa-12',
      flagId: 'f-yeni',
      name: 'Yeni oyuncu',
      color: null,
      addedAt: once(402 * gun),
      removedAt: once(330 * gun),
      expiresAt: null,
      reason: null,
      active: false,
    },
  ] satisfies Flag[],
  records: [
    {
      id: 'r-903',
      kind: 'watchlist' as const,
      body: 'Ban bitince ilk maçta izlenecek. Aynı mangada tekrar TK olursa kalıcıya çevrilir.',
      authorName: 'Yalnızkurt',
      createdAt: once(5 * gun - 4 * saat),
      resolvedAt: null,
    },
    {
      id: 'r-871',
      kind: 'warning' as const,
      body: 'Manga liderinin talimatını dinlemeyip aracı tek başına götürdü. Sözlü uyarı verildi.',
      authorName: 'Çelik',
      createdAt: once(19 * gun),
      resolvedAt: null,
    },
    {
      id: 'r-644',
      kind: 'note' as const,
      body: 'Türkçe bilmiyor, İngilizce anlaşıyor. Uyarıları İngilizce yazmak gerekiyor.',
      authorName: 'Demirci',
      createdAt: once(58 * gun),
      resolvedAt: once(57 * gun),
    },
    {
      id: 'r-590',
      kind: 'warning' as const,
      body: 'Maç başında rastgele ateş açtı, iki kişi öldü. Uyarı yazıldı.',
      authorName: 'Demirci',
      createdAt: once(74 * gun),
      resolvedAt: once(70 * gun),
    },
  ],
  sohbet: [
    {
      id: 'm-9',
      channel: 'Admin',
      message: 'admin neden banlandım',
      sentAt: once(5 * gun - 3 * saat),
    },
    { id: 'm-8', channel: 'Team', message: 'sorry wrong target', sentAt: once(5 * gun - 4 * saat) },
    {
      id: 'm-7',
      channel: 'Squad',
      message: 'logi geliyor bekleyin',
      sentAt: once(5 * gun - 5 * saat),
    },
    { id: 'm-6', channel: 'All', message: 'gg ez', sentAt: once(6 * gun) },
    { id: 'm-5', channel: 'Squad', message: 'mayın var ilerlemeyin', sentAt: once(6 * gun + saat) },
    { id: 'm-4', channel: 'Team', message: 'hab yandı kim koydu onu oraya', sentAt: once(8 * gun) },
    { id: 'm-3', channel: 'All', message: 'map degissin artik', sentAt: once(11 * gun) },
    { id: 'm-2', channel: 'Squad', message: 'ben medic aliyorum', sentAt: once(13 * gun) },
    {
      id: 'm-1',
      channel: 'Admin',
      message: 'bu adam surekli tk yapiyor bakin',
      sentAt: once(21 * gun),
    },
  ],
  oyun: {
    oturum: 90,
    toplamSaniye: 512_400,
    ilkGorulme: once(402 * gun),
    sonGorulme: once(2 * gun),
    mac: MAC_GALIBIYET + MAC_MAGLUBIYET,
    kill: KILL,
    olum: OLUM,
    revive: 212,
    tk: 7,
    enUzunSeri: 14,
    galibiyet: MAC_GALIBIYET,
    maglubiyet: MAC_MAGLUBIYET,
    galibiyetOrani: Math.round((MAC_GALIBIYET / (MAC_GALIBIYET + MAC_MAGLUBIYET)) * 100),
  },
};

/** Birlikte oynadıkları — profil panelinde istek üzerine yüklenen liste. */
export const ORNEK_COPLAY = [
  {
    playerId: 'p-2c91',
    name: 'Yıldırım',
    steamId: '76561198003311277',
    birlikteSaniye: 96_480,
    oturum: 31,
  },
  {
    playerId: 'p-7b04',
    name: 'Demirci',
    steamId: '76561198119044821',
    birlikteSaniye: 71_220,
    oturum: 24,
  },
  {
    playerId: 'p-1a55',
    name: 'Kaplan',
    steamId: '76561198077120933',
    birlikteSaniye: 43_800,
    oturum: 17,
  },
  {
    playerId: 'p-9e30',
    name: '[ALT] Poyraz',
    steamId: '76561198200481166',
    birlikteSaniye: 21_600,
    oturum: 9,
  },
  {
    playerId: 'p-3d78',
    name: 'Sessiz',
    steamId: '76561198088217340',
    birlikteSaniye: 7_380,
    oturum: 4,
  },
];

/** Atanabilecek etiketler — profildeki seçici bunu okuyor. */
export const ORNEK_ETIKETLER = [
  {
    id: 'f-tk',
    name: 'TK eğilimi',
    description: 'Takım arkadaşı öldürme geçmişi var',
    color: '#d9a441',
  },
  {
    id: 'f-takip',
    name: 'Takipte',
    description: 'Bir sonraki olayda kalıcı ban',
    color: '#4a8ad6',
  },
  { id: 'f-yeni', name: 'Yeni oyuncu', description: '10 maçın altında', color: null },
  { id: 'f-mikrofonsuz', name: 'Mikrofonsuz', description: 'Sesli iletişim kurmuyor', color: null },
  { id: 'f-lider', name: 'Manga lideri', description: 'Güvenilir manga lideri', color: '#44a282' },
];

// --------------------------------------------------------------- arama

export const ORNEK_ARAMA = [
  {
    id: 'p-8f3a21',
    name: 'Bozkurt',
    steamId: '76561198042318855',
    eskiIsimler: ['[ALT] Bozkurt', 'Kurt_57'],
    sonGorulme: once(2 * gun),
    banli: true,
    acikKayit: 2,
    toplamSaniye: 512_400,
  },
  {
    id: 'p-2c91',
    name: 'Yıldırım',
    steamId: '76561198003311277',
    eskiIsimler: [],
    sonGorulme: once(4 * saat),
    banli: false,
    acikKayit: 0,
    toplamSaniye: 1_043_760,
  },
  {
    id: 'p-7b04',
    name: 'Demirci',
    steamId: '76561198119044821',
    eskiIsimler: ['Demirci|ALT'],
    sonGorulme: once(saat),
    banli: false,
    acikKayit: 0,
    toplamSaniye: 2_221_200,
  },
  {
    id: 'p-1a55',
    name: 'Kaplan',
    steamId: '76561198077120933',
    eskiIsimler: [],
    sonGorulme: once(31 * gun),
    banli: false,
    acikKayit: 1,
    toplamSaniye: 187_020,
  },
  {
    id: 'p-3d78',
    name: 'Sessiz',
    steamId: '76561198088217340',
    eskiIsimler: ['adsiz'],
    sonGorulme: once(118 * gun),
    banli: false,
    acikKayit: 0,
    toplamSaniye: 24_480,
  },
];

// ------------------------------------------------------------ sıralama

/**
 * Sıralama — api `limit=25` ile çekiyor, burada 17 satır var.
 *
 * SAYI ÖNEMLİ: altı satırla ekranın altında 300 piksel boşluk kalıyordu
 * ve denetleyici bunu haklı olarak "yerleştirilmemiş boşluk" sayıyordu.
 * Gerçek bir sunucunun aylık listesi bu uzunlukta; tasarım gerçek
 * yoğunlukta görülmeli.
 *
 * K/D her satırda kill/ölüm oranının iki ondalığı — elle yazılmıyor.
 */
const SIRALAMA_HAM: [string, string, string, number, number, number, number][] = [
  // [playerId, steamId, ad, maç, öldürme, ölüm, canlandırma]
  ['p-7b04', '76561198119044821', 'Demirci', 311, 6_842, 3_104, 918],
  ['p-2c91', '76561198003311277', 'Yıldırım', 204, 4_117, 2_388, 1_204],
  ['p-4a12', '76561198031887402', 'Çelik', 188, 3_902, 2_011, 702],
  ['p-6c88', '76561198144920377', 'Boran', 142, 2_615, 1_744, 455],
  ['p-5f21', '76561198099713044', 'Yağmur', 119, 2_208, 1_357, 866],
  ['p-2b67', '76561198061228590', 'Alpagut', 97, 1_703, 1_189, 318],
  ['p-8d04', '76561198173044811', 'Tuğra', 84, 1_456, 1_102, 274],
  ['p-8f3a21', '76561198042318855', 'Bozkurt', 61, 1_284, 698, 212],
  ['p-1e93', '76561198112660734', 'Mete', 73, 1_189, 944, 190],
  ['p-7a40', '76561198020974128', 'Oğuz', 66, 1_021, 877, 141],
  ['p-1a55', '76561198077120933', 'Kaplan', 44, 902, 611, 88],
  ['p-3b19', '76561198155083291', 'Baybars', 52, 744, 713, 97],
  ['p-9e30', '76561198200481166', '[ALT] Poyraz', 37, 640, 588, 341],
  ['p-4d72', '76561198007741360', 'Ergin', 41, 561, 604, 73],
  ['p-6e55', '76561198188302417', 'Umay', 29, 342, 411, 126],
  ['p-2f08', '76561198134990226', 'Korkut', 21, 214, 288, 44],
  ['p-3d78', '76561198088217340', 'Sessiz', 12, 97, 140, 6],
];

export const ORNEK_SIRALAMA = SIRALAMA_HAM.map(
  ([playerId, steamId, name, rounds, kills, deaths, revives]) => ({
    playerId,
    steamId,
    name,
    rounds,
    kills,
    deaths,
    revives,
    kdr: Number((kills / deaths).toFixed(2)),
  }),
);

// ------------------------------------------------------------- talepler

/**
 * Talep kuyruğu — 12 kayıt.
 *
 * Beş satırla ekranın alt üçte biri boş kalıyordu; gerçek bir sunucunun
 * kuyruğu bu uzunlukta ve tasarımın gerçek yoğunlukta görülmesi gerekiyor.
 * Dördü hâlâ bekliyor (açık + üstlenilmiş), gerisi kapalı.
 */
export const ORNEK_TALEPLER = [
  {
    id: 't-311',
    number: 311,
    subject: 'Haksız ban itirazı',
    category: 'ban-itiraz',
    status: 'open',
    openedByDiscordId: '402118855991',
    openedByPlayerId: 'p-8f3a21',
    discordThreadId: '1299881',
    claimedByDiscordId: null,
    createdAt: once(4 * saat),
    closedAt: null,
    mesajSayisi: 6,
  },
  {
    id: 't-310',
    number: 310,
    subject: 'Mangamda sürekli TK yapan oyuncu var',
    category: 'sikayet',
    status: 'claimed',
    openedByDiscordId: '402118800112',
    openedByPlayerId: 'p-1a55',
    discordThreadId: '1299740',
    claimedByDiscordId: '55110022',
    createdAt: once(22 * saat),
    closedAt: null,
    mesajSayisi: 14,
  },
  {
    id: 't-309',
    number: 309,
    subject: 'Klan etiketim panelde görünmüyor',
    category: 'klan',
    status: 'claimed',
    openedByDiscordId: '402118744003',
    openedByPlayerId: 'p-9e30',
    discordThreadId: '1299611',
    claimedByDiscordId: '55110022',
    createdAt: once(2 * gun),
    closedAt: null,
    mesajSayisi: 3,
  },
  {
    id: 't-308',
    number: 308,
    subject: 'Sunucuya bağlanamıyorum, EAC hatası',
    category: 'teknik',
    status: 'closed',
    openedByDiscordId: '402118009988',
    openedByPlayerId: 'p-3d78',
    discordThreadId: '1299400',
    claimedByDiscordId: '55110088',
    createdAt: once(6 * gun),
    closedAt: once(5 * gun),
    mesajSayisi: 9,
  },
  {
    id: 't-307',
    number: 307,
    subject: 'Admin başvurusu',
    category: 'basvuru',
    status: 'closed',
    openedByDiscordId: '402117220011',
    openedByPlayerId: 'p-2c91',
    discordThreadId: '1299118',
    claimedByDiscordId: '55110022',
    createdAt: once(12 * gun),
    closedAt: once(9 * gun),
    mesajSayisi: 21,
  },
  {
    id: 't-306',
    number: 306,
    subject: 'Mikrofonum sunucuda çalışmıyor',
    category: 'teknik',
    status: 'open',
    openedByDiscordId: '402116880014',
    openedByPlayerId: 'p-4a12',
    discordThreadId: '1298902',
    claimedByDiscordId: null,
    createdAt: once(9 * saat),
    closedAt: null,
    mesajSayisi: 2,
  },
  {
    id: 't-305',
    number: 305,
    subject: 'Klan savaşı kadro listesi güncellenmeli',
    category: 'klan',
    status: 'closed',
    openedByDiscordId: '402116004477',
    openedByPlayerId: 'p-6c88',
    discordThreadId: '1298744',
    claimedByDiscordId: '55110033',
    createdAt: once(15 * gun),
    closedAt: once(14 * gun),
    mesajSayisi: 7,
  },
  {
    id: 't-304',
    number: 304,
    subject: 'Yanlışlıkla mangamı dağıttım, geri alınabilir mi',
    category: 'sikayet',
    status: 'closed',
    openedByDiscordId: '402115771200',
    openedByPlayerId: 'p-5f21',
    discordThreadId: '1298511',
    claimedByDiscordId: '55110088',
    createdAt: once(18 * gun),
    closedAt: once(18 * gun),
    mesajSayisi: 4,
  },
  {
    id: 't-303',
    number: 303,
    subject: 'Sunucuda Türkçe kuralı hâlâ geçerli mi',
    category: 'kural',
    status: 'closed',
    openedByDiscordId: '402115220099',
    openedByPlayerId: 'p-2b67',
    discordThreadId: '1298307',
    claimedByDiscordId: '55110022',
    createdAt: once(24 * gun),
    closedAt: once(23 * gun),
    mesajSayisi: 11,
  },
  {
    id: 't-302',
    number: 302,
    subject: 'Bağış sonrası whitelist gelmedi',
    category: 'basvuru',
    status: 'closed',
    openedByDiscordId: '402114990088',
    openedByPlayerId: 'p-8d04',
    discordThreadId: '1298140',
    claimedByDiscordId: '55110033',
    createdAt: once(29 * gun),
    closedAt: once(28 * gun),
    mesajSayisi: 6,
  },
  {
    id: 't-301',
    number: 301,
    subject: 'Oyuncu adımı değiştirdim, istatistiklerim kayboldu',
    category: 'teknik',
    status: 'closed',
    openedByDiscordId: '402114220011',
    openedByPlayerId: 'p-1e93',
    discordThreadId: '1297988',
    claimedByDiscordId: '55110088',
    createdAt: once(34 * gun),
    closedAt: once(31 * gun),
    mesajSayisi: 13,
  },
];

// -------------------------------------------------------- klan savaşları

/** Klan savaşları — bir canlı, bir lobi, iki planlı, gerisi geçmiş. */
export const ORNEK_SAVASLAR = [
  {
    id: 'w-18',
    name: 'ALT vs TRK · Yehorivka',
    status: 'live',
    scheduledAt: once(42 * 60_000),
    lockedAt: once(55 * 60_000),
  },
  {
    id: 'w-17',
    name: 'ALT vs BZK · Gorodok',
    status: 'lobby',
    scheduledAt: sonra(2 * saat),
    lockedAt: null,
  },
  {
    id: 'w-16',
    name: 'ALT vs KPL · Narva',
    status: 'planned',
    scheduledAt: sonra(3 * gun),
    lockedAt: null,
  },
  {
    id: 'w-19',
    name: 'TRK vs BZK · Chora',
    status: 'planned',
    scheduledAt: sonra(9 * gun),
    lockedAt: null,
  },
  {
    id: 'w-15',
    name: 'ALT vs TRK · Fallujah',
    status: 'finished',
    scheduledAt: once(7 * gun),
    lockedAt: once(7 * gun),
  },
  {
    id: 'w-13',
    name: 'ALT vs KPL · Goose Bay',
    status: 'finished',
    scheduledAt: once(21 * gun),
    lockedAt: once(21 * gun),
  },
  {
    id: 'w-12',
    name: 'TRK vs SSZ · Kohat',
    status: 'finished',
    scheduledAt: once(28 * gun),
    lockedAt: once(28 * gun),
  },
  {
    id: 'w-11',
    name: 'ALT vs BZK · Tallil',
    status: 'finished',
    scheduledAt: once(35 * gun),
    lockedAt: once(35 * gun),
  },
  {
    id: 'w-14',
    name: 'ALT vs SSZ · Mutaha',
    status: 'cancelled',
    scheduledAt: once(14 * gun),
    lockedAt: null,
  },
  {
    id: 'w-10',
    name: 'KPL vs BZK · Logar',
    status: 'cancelled',
    scheduledAt: once(42 * gun),
    lockedAt: null,
  },
];

// ------------------------------------------------------------- klanlar

export const ORNEK_KLANLAR = [
  {
    id: 'c-1',
    tag: 'ALT',
    name: 'Altai',
    memberSteamIds: [
      '76561198042318855',
      '76561198003311277',
      '76561198119044821',
      '76561198200481166',
      '76561198031887402',
      '76561198099713044',
    ],
    rivalClanIds: ['c-2'],
  },
  {
    id: 'c-2',
    tag: 'TRK',
    name: 'Türkler',
    memberSteamIds: ['76561198077120933', '76561198088217340', '76561198144920377'],
    rivalClanIds: ['c-1'],
  },
  {
    id: 'c-3',
    tag: 'BZK',
    name: 'Bozkır',
    memberSteamIds: ['76561198061228590', '76561198173044811'],
    rivalClanIds: [],
  },
  {
    id: 'c-4',
    tag: 'KPL',
    name: 'Kaplanlar',
    memberSteamIds: ['76561198112660734', '76561198020974128', '76561198155083291'],
    rivalClanIds: ['c-5'],
  },
  {
    id: 'c-5',
    tag: 'SSZ',
    name: 'Sessizler',
    memberSteamIds: ['76561198007741360', '76561198188302417'],
    rivalClanIds: ['c-4'],
  },
];

// ------------------------------------------------------------- kurallar

export const ORNEK_KURALLAR = [
  {
    id: 'k-1',
    siraNo: 1,
    baslik: 'Takım arkadaşını öldürmek yasak',
    metin: "Kasten TK yapan oyuncu ilk seferde uyarılır, tekrarında banlanır. Kaza TK'si sayılmaz.",
    aktif: true,
  },
  {
    id: 'k-2',
    siraNo: 2,
    baslik: 'Manga liderinin talimatına uyulur',
    metin: 'Mangadan kopup tek başına hareket eden oyuncu mangadan çıkarılabilir.',
    aktif: true,
  },
  {
    id: 'k-3',
    siraNo: 3,
    baslik: 'Küfür ve hakaret yasak',
    metin: 'Genel sohbette, takım sohbetinde ve sesli iletişimde geçerli.',
    aktif: true,
  },
  {
    id: 'k-4',
    siraNo: 4,
    baslik: 'Araç çalmak yasak',
    metin: 'Mangaya ait aracı izinsiz almak kural ihlalidir.',
    aktif: true,
  },
  {
    id: 'k-5',
    siraNo: 5,
    baslik: 'Sunucuda Türkçe konuşulur',
    metin:
      'Bu kural kaldırıldı: uluslararası oyuncular geldikten sonra İngilizce de kabul ediliyor.',
    aktif: false,
  },
];

// -------------------------------------------------------------- yetkiler

export const ORNEK_YETKILER = {
  roller: [
    {
      id: 'rm-1',
      discordRoleId: '1101',
      discordRoleName: 'Kurucu',
      permissions: [
        'player.ban',
        'player.kick',
        'player.warn',
        'player.note.write',
        'flag.manage',
        'audit.read',
        'admin_list.manage',
        'clan.manage',
        'rules.manage',
        'ticket.manage',
        'server.control',
        'plugin_config.write',
      ],
      squadGroup: 'Admin',
      uyeSayisi: 2,
    },
    {
      id: 'rm-2',
      discordRoleId: '1102',
      discordRoleName: 'Yönetici',
      permissions: [
        'player.ban',
        'player.kick',
        'player.warn',
        'player.note.write',
        'flag.manage',
        'audit.read',
        'ticket.manage',
        'server.control',
      ],
      squadGroup: 'Moderator',
      uyeSayisi: 5,
    },
    {
      id: 'rm-3',
      discordRoleId: '1103',
      discordRoleName: 'Moderatör',
      permissions: ['player.kick', 'player.warn', 'player.note.write', 'ticket.manage'],
      squadGroup: 'Moderator',
      uyeSayisi: 11,
    },
    {
      id: 'rm-4',
      discordRoleId: '1104',
      discordRoleName: 'Klan sorumlusu',
      permissions: ['clan.manage'],
      squadGroup: 'Whitelist',
      uyeSayisi: 3,
    },
    {
      id: 'rm-5',
      discordRoleId: '1105',
      discordRoleName: 'Bağışçı',
      permissions: [],
      squadGroup: 'Whitelist',
      uyeSayisi: 28,
    },
  ],
  squadGruplari: ['Admin', 'Moderator', 'Whitelist'],
};

// -------------------------------------------------------------- kayıtlar

/**
 * Denetim günlüğü.
 *
 * İKİ KURAL:
 *
 *  1. EYLEM KODLARI GERÇEK. activity-log.tsx içindeki `EYLEM_ADI`
 *     tablosunda karşılığı olan kodlar yazılıyor; olmayan bir kod
 *     ("player.ban" gibi) ekranda ham hâlde görünüyor ve günlüğü ancak
 *     kodu yazan okuyabiliyor.
 *
 *  2. OLAYLAR SON 24 SAATTE. Üstteki rakam şeridi "son 24 saat" diyor;
 *     listenin haftalar öncesine ait olması ikisini çelişkili kılıyordu.
 *     Şerit 90 olay sayıyor, liste onun ilk sayfası.
 */
export const ORNEK_KAYITLAR = {
  olaylar: [
    {
      id: 'a-9914',
      kategori: 'sistem',
      eylem: 'agent.connect',
      aktorAd: null,
      hedef: 'squad-01',
      hedefId: null,
      detay: null,
      zaman: once(12 * 60_000),
    },
    {
      id: 'a-9913',
      kategori: 'sistem',
      eylem: 'agent.disconnect',
      aktorAd: null,
      hedef: 'squad-01',
      hedefId: null,
      detay: '4 dk 12 sn kopuk',
      zaman: once(16 * 60_000),
    },
    {
      id: 'a-9912',
      kategori: 'moderasyon',
      eylem: 'ingame.warn',
      aktorAd: 'Çelik',
      hedef: 'Kaplan',
      hedefId: 'p-1a55',
      detay: 'Manga talimatına uymadı',
      zaman: once(34 * 60_000),
    },
    {
      id: 'a-9911',
      kategori: 'okuma',
      eylem: 'http.get',
      aktorAd: 'Çelik',
      hedef: 'Kaplan',
      hedefId: 'p-1a55',
      detay: null,
      zaman: once(36 * 60_000),
    },
    {
      id: 'a-9910',
      kategori: 'moderasyon',
      eylem: 'player.kick',
      aktorAd: 'Yalnızkurt',
      hedef: 'Korkut',
      hedefId: 'p-2f08',
      detay: 'Maç başında takım aracını patlattı',
      zaman: once(2 * saat),
    },
    {
      id: 'a-9909',
      kategori: 'moderasyon',
      eylem: 'server.broadcast',
      aktorAd: 'Yalnızkurt',
      hedef: null,
      hedefId: null,
      detay: 'Klan savaşı 22:00 başlıyor',
      zaman: once(3 * saat),
    },
    {
      id: 'a-9908',
      kategori: 'oturum',
      eylem: 'auth.login',
      aktorAd: 'Yalnızkurt',
      hedef: null,
      hedefId: null,
      detay: 'discord',
      zaman: once(3 * saat + 20 * 60_000),
    },
    {
      id: 'a-9907',
      kategori: 'moderasyon',
      eylem: 'record.resolve',
      aktorAd: 'Demirci',
      hedef: 'Mete',
      hedefId: 'p-1e93',
      detay: 'Uyarı kapatıldı',
      zaman: once(5 * saat),
    },
    {
      id: 'a-9906',
      kategori: 'erisim',
      eylem: 'role_mapping.upsert',
      aktorAd: 'Demirci',
      hedef: 'Moderatör',
      hedefId: 'rm-3',
      detay: 'ticket.manage eklendi',
      zaman: once(6 * saat),
    },
    {
      id: 'a-9905',
      kategori: 'moderasyon',
      eylem: 'flag.assign',
      aktorAd: 'Demirci',
      hedef: 'Bozkurt',
      hedefId: 'p-8f3a21',
      detay: 'Takipte',
      zaman: once(7 * saat),
    },
    {
      id: 'a-9904',
      kategori: 'okuma',
      eylem: 'http.get',
      aktorAd: 'Demirci',
      hedef: 'Bozkurt',
      hedefId: 'p-8f3a21',
      detay: null,
      zaman: once(7 * saat + 90_000),
    },
    {
      id: 'a-9903',
      kategori: 'moderasyon',
      eylem: 'ingame.cam_enter',
      aktorAd: 'Çelik',
      hedef: null,
      hedefId: null,
      detay: null,
      zaman: once(9 * saat),
    },
    {
      id: 'a-9902',
      kategori: 'oturum',
      eylem: 'auth.logout',
      aktorAd: 'Boran',
      hedef: null,
      hedefId: null,
      detay: null,
      zaman: once(11 * saat),
    },
    {
      id: 'a-9901',
      kategori: 'moderasyon',
      eylem: 'ban.create',
      aktorAd: 'Yalnızkurt',
      hedef: 'Bozkurt',
      hedefId: 'p-8f3a21',
      detay: 'Takım arkadaşlarını kasten öldürdü · 14 gün',
      zaman: once(19 * saat),
    },
    {
      id: 'a-9900',
      kategori: 'okuma',
      eylem: 'http.get',
      aktorAd: 'Yalnızkurt',
      hedef: 'Bozkurt',
      hedefId: 'p-8f3a21',
      detay: null,
      zaman: once(19 * saat + 90_000),
    },
  ],
  /**
   * Son 24 saat özeti — kategoriye göre adet.
   *
   * Listedekiler bunun ilk sayfası: şerit 90 olay sayıyor, günlük
   * sayfalı olduğu için ekranda ilk 15'i duruyor.
   */
  son24Saat: [
    { kategori: 'moderasyon', adet: 12 },
    { kategori: 'erisim', adet: 2 },
    { kategori: 'oturum', adet: 9 },
    { kategori: 'okuma', adet: 64 },
    { kategori: 'sistem', adet: 3 },
  ],
};

// ------------------------------------------------------- canlı sunucu

const TAKIM1_MANGALAR = [
  { no: 1, ad: 'CMD', lider: 'Demirci', mevcut: 2 },
  { no: 2, ad: 'INF', lider: 'Yıldırım', mevcut: 9 },
  { no: 3, ad: 'ARMOR', lider: 'Kaplan', mevcut: 3 },
  { no: 4, ad: 'LOGI', lider: 'Sessiz', mevcut: 4 },
];

const TAKIM2_MANGALAR = [
  { no: 1, ad: 'CMD', lider: 'Poyraz', mevcut: 2 },
  { no: 2, ad: 'INF', lider: 'Çelik', mevcut: 8 },
  { no: 3, ad: 'MORTAR', lider: 'Boran', mevcut: 2 },
];

const TAKIM1_SAYI = TAKIM1_MANGALAR.reduce((t, m) => t + m.mevcut, 0);
const TAKIM2_SAYI = TAKIM2_MANGALAR.reduce((t, m) => t + m.mevcut, 0);

export const ORNEK_CANLI = {
  sunucu: {
    slug: 'squad-01',
    ad: 'Altai Squad #1',
    harita: 'Yehorivka',
    katman: 'Yehorivka_AAS_v1',
    oyuncuSayisi: TAKIM1_SAYI + TAKIM2_SAYI,
    kapasite: 100,
    siradaki: 3,
    takim1Bilet: 612,
    takim2Bilet: 574,
    macBaslangic: once(38 * 60_000),
    agentBagli: true,
  },
  takim1: { ad: 'Rusya', mangalar: TAKIM1_MANGALAR, sayi: TAKIM1_SAYI },
  takim2: { ad: 'ABD', mangalar: TAKIM2_MANGALAR, sayi: TAKIM2_SAYI },
  oyuncular: [
    {
      steamId: '76561198119044821',
      ad: 'Demirci',
      takim: 1,
      manga: 1,
      lider: true,
      playerId: 'p-7b04',
    },
    {
      steamId: '76561198003311277',
      ad: 'Yıldırım',
      takim: 1,
      manga: 2,
      lider: true,
      playerId: 'p-2c91',
    },
    {
      steamId: '76561198077120933',
      ad: 'Kaplan',
      takim: 1,
      manga: 3,
      lider: true,
      playerId: 'p-1a55',
    },
    {
      steamId: '76561198088217340',
      ad: 'Sessiz',
      takim: 1,
      manga: 4,
      lider: true,
      playerId: 'p-3d78',
    },
    {
      steamId: '76561198200481166',
      ad: '[ALT] Poyraz',
      takim: 2,
      manga: 1,
      lider: true,
      playerId: 'p-9e30',
    },
  ],
  sohbet: [
    {
      id: 'c-5',
      kanal: 'Admin',
      oyuncu: 'Kaplan',
      mesaj: 'admin mangada tk var',
      zaman: once(3 * 60_000),
    },
    { id: 'c-4', kanal: 'All', oyuncu: 'Yıldırım', mesaj: 'logi yolda', zaman: once(7 * 60_000) },
    {
      id: 'c-3',
      kanal: 'Team',
      oyuncu: 'Demirci',
      mesaj: 'hab kuruldu kuzeyde',
      zaman: once(11 * 60_000),
    },
    {
      id: 'c-2',
      kanal: 'Squad',
      oyuncu: 'Sessiz',
      mesaj: 'mayin var dikkat',
      zaman: once(19 * 60_000),
    },
    { id: 'c-1', kanal: 'All', oyuncu: '[ALT] Poyraz', mesaj: 'gl hf', zaman: once(37 * 60_000) },
  ],
};

/**
 * Doğrulamalar.
 *
 * Toplamların satırlarla tuttuğunu önizleme açılırken konsola yazıyor.
 * Derlemeyi kırmıyor: örnek veriyi düzenleyen biri sayıyı bozunca
 * konsolda görüyor, panel çalışmaya devam ediyor.
 */
export function ornekVeriyiDogrula(): string[] {
  const sorun: string[] = [];
  const o = ORNEK_OYUNCU.oyun;

  if (o.galibiyet + o.maglubiyet !== o.mac) {
    sorun.push(`maç ${o.mac} ≠ galibiyet ${o.galibiyet} + mağlubiyet ${o.maglubiyet}`);
  }
  if (o.galibiyetOrani !== Math.round((o.galibiyet / o.mac) * 100)) {
    sorun.push('galibiyet oranı maç sayısıyla tutmuyor');
  }
  const aktifBan = ORNEK_OYUNCU.bans.filter((b) => b.active).length;
  if (aktifBan > 1) sorun.push(`${aktifBan} aktif ban — en fazla bir tane olabilir`);

  const kdr = ORNEK_SIRALAMA.find((s) => s.playerId === 'p-8f3a21');
  if (kdr && kdr.kdr !== Number((o.kill / o.olum).toFixed(2))) {
    sorun.push('sıralamadaki K/D profildeki kill/ölümle tutmuyor');
  }
  if (kdr && (kdr.kills !== o.kill || kdr.deaths !== o.olum || kdr.rounds !== o.mac)) {
    sorun.push('sıralamadaki Bozkurt satırı profildeki rakamlarla tutmuyor');
  }

  if (ORNEK_CANLI.sunucu.oyuncuSayisi !== ORNEK_CANLI.takim1.sayi + ORNEK_CANLI.takim2.sayi) {
    sorun.push('canlı sunucu oyuncu sayısı takım toplamlarıyla tutmuyor');
  }

  const kayitToplam = ORNEK_KAYITLAR.son24Saat.reduce((t, s) => t + s.adet, 0);
  if (kayitToplam !== 90) sorun.push(`son 24 saat toplamı ${kayitToplam}, beklenen 90`);

  return sorun;
}
