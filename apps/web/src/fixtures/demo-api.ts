import type { Kayit } from '@/components/activity-log';
import type { Uye } from '@/components/klanlar';
import type { Veri as YetkiVerisi } from '@/components/role-mappings';
import { ALTAI_KURALLARI } from '@/fixtures/altai-kurallari';
import {
  ORNEK_ARAMA,
  ORNEK_ETIKETLER,
  ORNEK_KAYITLAR,
  ORNEK_KLANLAR,
  ORNEK_OYUNCU,
  ORNEK_SAVASLAR,
  ORNEK_SIRALAMA,
  ORNEK_TALEPLER,
  ORNEK_YETKILER,
} from '@/fixtures/ornek';

/**
 * Demo kipinin sahte api'si.
 *
 * `ALTAI_DEMO=1` iken `getJson` buraya düşüyor: gerçek sayfalar gerçek
 * rotalarında, örnek veriyle açılıyor. Böylece Postgres, api ve Discord
 * kurmadan panelin tamamı gezilebiliyor.
 *
 * YALNIZCA GELİŞTİRME. Bu dosya üretim paketine girmiyor: `api.ts` onu
 * dinamik `import()` ile ve `NODE_ENV !== 'production'` koşuluyla
 * yüklüyor.
 *
 * Eşleşmeyen bir yol `null` dönüyor, yani sayfa "yüklenemedi" durumunu
 * gösteriyor. Bu da bir tasarım durumu; boş ekran vermekten iyi.
 */

/** Örnek oyuncunun profili — api'nin `/players/:id` cevabının şekli. */
export function demoProfil(bmsiz = false) {
  // `bmsiz`: api'nin BM alanını hiç döndürmediği eski sürümü taklit
  // eder. Ekran o durumda da açılmalı (bkz. profil-ekrani.tsx → bm).
  if (bmsiz) {
    const { ...kalan } = ORNEK_OYUNCU;
    return kalan;
  }
  return {
    ...ORNEK_OYUNCU,
    // BattleMetrics aynası başka bir oturumda geliştiriliyor; demo
    // kipinde kapalı görünüyor ki sayfa onu "henüz alınmadı" diye
    // çizsin, uydurma veriyle değil.
    bm: {
      acik: false,
      bmPlayerId: null,
      syncedAt: null,
      status: null,
      erisilemeyen: [],
      sunucular: [],
      banlar: [],
    },
  };
}

/** Günlük satırı — örnek olayları gerçek kayıt şekline çeviriyor. */
function gunlukSatirlari(): Kayit[] {
  return ORNEK_KAYITLAR.olaylar.map((o) => ({
    id: o.id,
    at: o.zaman,
    actorType: o.aktorAd ? 'user' : 'system',
    actorUserId: o.aktorAd ? `u-${o.id}` : null,
    actorLabel: o.aktorAd,
    action: o.eylem,
    category: o.kategori,
    targetType: o.hedefId?.startsWith('p-') ? 'player' : o.hedef ? 'other' : null,
    targetId: o.hedefId,
    targetLabel: o.hedef,
    method: o.kategori === 'okuma' ? 'GET' : null,
    path: o.kategori === 'okuma' ? `/api/players/${o.hedefId}` : null,
    route: o.kategori === 'okuma' ? '/api/players/:id' : null,
    statusCode: o.kategori === 'okuma' ? 200 : null,
    durationMs: o.kategori === 'okuma' ? 48 : null,
    ip: '10.0.0.14',
    payload: o.detay ? { detay: o.detay } : null,
    requestId: `req-${o.id}`,
  }));
}

function yetkiVerisi(): YetkiVerisi {
  return {
    mappings: ORNEK_YETKILER.roller.map((r) => ({
      id: r.id,
      discordRoleId: r.discordRoleId,
      systemRole: r.discordRoleName === 'Kurucu' ? 'super_admin' : 'moderator',
      panelPermissions: r.permissions,
      squadGroup: r.squadGroup,
      uyeSayisi: r.uyeSayisi,
    })),
    squadGroups: ORNEK_YETKILER.squadGruplari.map((ad, i) => ({
      id: `sg-${i}`,
      name: ad,
      squadPermissions:
        ad === 'Admin'
          ? ['canKick', 'canBan', 'canSeeAdminChat', 'canChangeMap']
          : ad === 'Moderator'
            ? ['canKick', 'canSeeAdminChat']
            : ['canReserve'],
      grantMode: 'discord' as const,
      serverId: null,
      eslemeSayisi: ad === 'Whitelist' ? 2 : 1,
      grantSayisi: ad === 'Admin' ? 2 : ad === 'Moderator' ? 16 : 31,
    })),
    discordRoles: ORNEK_YETKILER.roller.map((r, i) => ({
      id: r.discordRoleId,
      name: r.discordRoleName,
      color: ['#e5566f', '#d9a441', '#4a8ad6', '#44a282', null][i] ?? null,
      position: ORNEK_YETKILER.roller.length - i,
    })),
    discordHata: null,
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
    systemRoles: ['super_admin', 'admin', 'moderator'],
    sonSenkron: new Date(Date.now() - 18 * 60_000).toISOString(),
  };
}

/** Klan üyeleri — üye sayıları klan listesiyle birebir aynı. */
function klanUyeleri(klanId: string): Uye[] {
  const klan = ORNEK_KLANLAR.find((k) => k.id === klanId);
  if (!klan) return [];
  return klan.memberSteamIds.map((steamId, i) => ({
    playerId: `p-${klan.id}-${i}`,
    steamId,
    eosId: null,
    addedAt: new Date(Date.now() - (i + 1) * 9 * 86_400_000).toISOString(),
  }));
}

/**
 * Yolu örnek veriye eşliyor.
 *
 * Sorgu dizesi ayrılıyor: `/stats/leaderboard?metric=kdr&limit=25` ile
 * `/stats/leaderboard` aynı cevabı alıyor, sıralama ölçütü de
 * uygulanıyor.
 */
export function demoCevap<T>(yol: string): T | null | undefined {
  const [taban, sorguHam] = yol.split('?');
  const sorgu = new URLSearchParams(sorguHam ?? '');
  const p = taban ?? '';

  // ---- sıralama ----
  if (p === '/stats/leaderboard') {
    const olcut = sorgu.get('metric') ?? 'kills';
    const satirlar = [...ORNEK_SIRALAMA].sort((a, b) => {
      if (olcut === 'kdr') return b.kdr - a.kdr;
      if (olcut === 'revives') return b.revives - a.revives;
      if (olcut === 'rounds') return b.rounds - a.rounds;
      return b.kills - a.kills;
    });
    return satirlar as T;
  }

  // ---- oyuncu ----
  if (p.startsWith('/players/')) {
    const kalan = p.slice('/players/'.length);
    if (kalan.endsWith('/coplay')) return { coplay: [] } as T;
    if (kalan.endsWith('/chat')) return { mesajlar: ORNEK_OYUNCU.sohbet, devam: false } as T;
    // `?bmsiz=1` ile BM alanı olmayan api sürümü taklit edilebiliyor.
    return demoProfil(sorgu.get('bmsiz') === '1') as T;
  }
  if (p === '/flags') return { flags: ORNEK_ETIKETLER } as T;

  // ---- talepler ----
  if (p === '/tickets') return { tickets: ORNEK_TALEPLER } as T;
  if (p.startsWith('/tickets/')) {
    const id = p.slice('/tickets/'.length);
    const ticket = ORNEK_TALEPLER.find((t) => t.id === id);
    if (!ticket) return undefined;
    return {
      ticket: { ...ticket, closeReason: null },
      mesajlar: [
        {
          id: 'tm-1',
          authorDiscordId: ticket.openedByDiscordId,
          authorName: 'Bozkurt',
          body: 'Banın sebebini anlamadım, maçta kimseyi kasten öldürmedim.',
          sentAt: ticket.createdAt,
          attachments: [],
        },
        {
          id: 'tm-2',
          authorDiscordId: '55110022',
          authorName: 'Yalnızkurt',
          body: 'Kayıtlara baktım, üç ayrı TK var ve ikisi uyarıdan sonra. Ban geçerli.',
          sentAt: new Date(new Date(ticket.createdAt).getTime() + 1_800_000).toISOString(),
          attachments: [],
        },
      ],
    } as T;
  }

  // ---- klanlar ----
  if (p === '/clans') {
    return {
      clans: ORNEK_KLANLAR.map((k) => ({
        id: k.id,
        name: k.name,
        tag: k.tag,
        color: null,
        uyeSayisi: k.memberSteamIds.length,
      })),
    } as T;
  }
  if (p.startsWith('/clans/') && p.endsWith('/members')) {
    const id = p.slice('/clans/'.length, -'/members'.length);
    return { members: klanUyeleri(id) } as T;
  }
  if (p.startsWith('/clans/') && p.includes('/stats')) {
    const id = p.slice('/clans/'.length, p.indexOf('/stats'));
    const klan = ORNEK_KLANLAR.find((k) => k.id === id);
    if (!klan) return undefined;
    const uyeler = ORNEK_SIRALAMA.slice(0, klan.memberSteamIds.length);
    return {
      clan: { id: klan.id, name: klan.name, tag: klan.tag },
      stat: {
        uyeSayisi: klan.memberSteamIds.length,
        aktifUye: Math.max(1, klan.memberSteamIds.length - 1),
        maclar: uyeler.reduce((t, u) => t + u.rounds, 0),
        kills: uyeler.reduce((t, u) => t + u.kills, 0),
        deaths: uyeler.reduce((t, u) => t + u.deaths, 0),
        revives: uyeler.reduce((t, u) => t + u.revives, 0),
      },
      uyeler,
    } as T;
  }

  // ---- klan savaşları ----
  if (p === '/clan-wars') return { wars: ORNEK_SAVASLAR } as T;
  if (p.startsWith('/clan-wars/')) {
    const id = p.slice('/clan-wars/'.length);
    const war = ORNEK_SAVASLAR.find((s) => s.id === id);
    if (!war) return undefined;
    return { war, takimlar: [], kadro: [] } as T;
  }

  // ---- kurallar ----
  if (p.startsWith('/rules')) {
    // GERÇEK kurallar (altaisquad.com/kurallar). Ban penceresi bunlardan
    // birini seçmeye zorluyor; örnek dört kuralla denemek 52 kurallı
    // listenin arama ve gruplama davranışını hiç göstermiyordu.
    return {
      rules: ALTAI_KURALLARI.map((k) => ({
        id: `kural-${k.kod}`,
        serverId: null,
        position: k.sira,
        title: k.kod,
        body: k.metin,
        category: k.bolum,
        active: true,
      })),
    } as T;
  }

  // ---- yetkiler ----
  if (p === '/role-mappings') return yetkiVerisi() as T;

  // ---- denetim günlüğü ----
  if (p === '/activity') return { satirlar: gunlukSatirlari(), sonrakiImlec: null } as T;
  if (p === '/activity/aktorler') {
    return {
      aktorler: [
        { id: 'u-1', ad: 'Yalnızkurt', adet: 42 },
        { id: 'u-2', ad: 'Demirci', adet: 27 },
        { id: 'u-3', ad: 'Çelik', adet: 19 },
      ],
    } as T;
  }
  if (p === '/activity/ozet') return { son24Saat: ORNEK_KAYITLAR.son24Saat } as T;

  // ---- yetkili kamerası ----
  if (p.startsWith('/admin-cam/ozet')) {
    return {
      yetkililer: [
        {
          playerId: 'p-7b04',
          steamId: '76561198119044821',
          name: 'Demirci',
          oturum: 14,
          toplamSaniye: 9_240,
          sonGiris: new Date(Date.now() - 2 * 3_600_000).toISOString(),
          acik: 1,
        },
        {
          playerId: 'p-4a12',
          steamId: '76561198031887402',
          name: 'Çelik',
          oturum: 9,
          toplamSaniye: 5_580,
          sonGiris: new Date(Date.now() - 9 * 3_600_000).toISOString(),
          acik: 0,
        },
        {
          playerId: 'p-2c91',
          steamId: '76561198003311277',
          name: 'Yıldırım',
          oturum: 3,
          toplamSaniye: 1_320,
          sonGiris: new Date(Date.now() - 4 * 86_400_000).toISOString(),
          acik: 0,
        },
      ],
    } as T;
  }
  if (p.startsWith('/admin-cam')) {
    const simdi = Date.now();
    return {
      oturumlar: [
        {
          id: 'ac-1',
          playerId: 'p-7b04',
          name: 'Demirci',
          steamId: '76561198119044821',
          serverSlug: 'squad-01',
          enteredAt: new Date(simdi - 2 * 3_600_000).toISOString(),
          leftAt: null,
          saniye: 7_200,
          acik: true,
        },
        {
          id: 'ac-2',
          playerId: 'p-4a12',
          name: 'Çelik',
          steamId: '76561198031887402',
          serverSlug: 'squad-01',
          enteredAt: new Date(simdi - 9 * 3_600_000).toISOString(),
          leftAt: new Date(simdi - 8 * 3_600_000).toISOString(),
          saniye: 3_600,
          acik: false,
        },
        {
          id: 'ac-3',
          playerId: 'p-2c91',
          name: 'Yıldırım',
          steamId: '76561198003311277',
          serverSlug: 'squad-01',
          enteredAt: new Date(simdi - 4 * 86_400_000).toISOString(),
          leftAt: new Date(simdi - 4 * 86_400_000 + 1_320_000).toISOString(),
          saniye: 1_320,
          acik: false,
        },
      ],
    } as T;
  }

  // ---- arama (istemciden çağrılıyor, burada yalnızca tamlık için) ----
  if (p === '/players/search') return { results: ORNEK_ARAMA, query: '' } as T;

  return null;
}
