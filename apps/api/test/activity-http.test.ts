import { describe, expect, it } from 'vitest';
import { gunlukYolu, kayitKarari, sirTemizle } from '../src/lib/activity-http.js';

/**
 * Günlük kuralları testle sabitleniyor çünkü iki yönde de hata sessiz:
 * fazla yazarsak günlük gürültüden okunamaz hâle gelir, az yazarsak hesap
 * sorulması gereken gün kayıt bulunmaz. İkisi de ancak birinin araması
 * gerektiğinde fark edilirdi.
 */

function istek(o: Partial<Parameters<typeof kayitKarari>[0]> = {}) {
  return kayitKarari({
    method: 'GET',
    route: '/api/players/search',
    url: '/api/players/search?q=test',
    statusCode: 200,
    oturumVar: true,
    ...o,
  });
}

describe('kayitKarari', () => {
  it('yazma isteklerini oturum olmasa bile kaydeder', () => {
    const k = istek({ method: 'POST', route: '/api/moderation/bans', oturumVar: false });
    expect(k.kaydet).toBe(true);
    expect(k.actorType).toBe('anonymous');
    expect(k.category).toBe('moderasyon');
  });

  it('giriş uçlarını moderasyona değil oturuma yazar', () => {
    // Giriş denemesi moderasyon sekmesinde görünüyordu ve "bugün kim ban
    // attı" sorusunun cevabını kirletiyordu.
    const k = istek({ method: 'POST', route: '/api/auth/break-glass', oturumVar: false });
    expect(k.category).toBe('oturum');
  });

  it('rol eşlemesi yazmalarını erişim kırılımına koyar', () => {
    expect(istek({ method: 'POST', route: '/api/role-mappings' }).category).toBe('erisim');
  });

  it('oturumlu okumayı "okuma" kategorisine yazar', () => {
    const k = istek();
    expect(k.kaydet).toBe(true);
    expect(k.category).toBe('okuma');
  });

  it('oturumsuz başarılı okumayı yazmaz', () => {
    expect(istek({ oturumVar: false }).kaydet).toBe(false);
  });

  it('yetki reddini her hâlükârda yazar', () => {
    const k = istek({ statusCode: 403 });
    expect(k.kaydet).toBe(true);
    expect(k.action).toBe('access.denied');
    expect(k.category).toBe('oturum');
  });

  it('sağlık kontrolünü hiç yazmaz', () => {
    expect(istek({ route: '/api/health', url: '/api/health' }).kaydet).toBe(false);
  });

  it('oturum yoklamasını yazmaz — her sayfa yüklemesinde geliyor', () => {
    expect(
      istek({ route: '/api/auth/me', url: '/api/auth/me', statusCode: 401, oturumVar: false })
        .kaydet,
    ).toBe(false);
  });

  it('oyun sunucusunun liste çekişlerini ayrı aktör tipiyle yazar', () => {
    const k = istek({
      route: '/api/ban-list/:token',
      url: '/api/ban-list/gercek-token',
      oturumVar: false,
    });
    expect(k.actorType).toBe('game_server');
    expect(k.action).toBe('ban_list.fetch');
  });

  it('OPTIONS ön kontrolünü yazmaz', () => {
    expect(istek({ method: 'OPTIONS' }).kaydet).toBe(false);
  });

  it('oturumsuz sunucu hatasını yazar', () => {
    const k = istek({ oturumVar: false, statusCode: 500 });
    expect(k.kaydet).toBe(true);
    expect(k.action).toBe('http.error');
  });
});

describe('sirTemizle', () => {
  it('parola ve token alanlarını maskeler', () => {
    const out = sirTemizle({ username: 'admin', password: 'gizli', api_key: 'abc' }) as Record<
      string,
      unknown
    >;
    expect(out.username).toBe('admin');
    expect(out.password).toBe('***');
    expect(out.api_key).toBe('***');
  });

  it('iç içe nesnelerde de maskeler', () => {
    const out = sirTemizle({ ust: { accessToken: 'x', ad: 'y' } }) as {
      ust: Record<string, unknown>;
    };
    expect(out.ust.accessToken).toBe('***');
    expect(out.ust.ad).toBe('y');
  });

  it('uzun metni kırpar', () => {
    const out = sirTemizle({ mesaj: 'a'.repeat(900) }) as { mesaj: string };
    expect(out.mesaj.length).toBeLessThan(600);
    expect(out.mesaj.endsWith('…')).toBe(true);
  });

  it('uzun diziyi kısaltıp kalanı sayar', () => {
    const out = sirTemizle(Array.from({ length: 25 }, (_, i) => i)) as unknown[];
    expect(out).toHaveLength(21);
    expect(out.at(-1)).toBe('…+5');
  });

  it('döngüsel derinlikte durur', () => {
    const derin = { a: { b: { c: { d: { e: 'dip' } } } } };
    expect(JSON.stringify(sirTemizle(derin))).toContain('[derin]');
  });
});

describe('gunlukYolu', () => {
  it('yola gömülü ban listesi token’ını maskeler', () => {
    expect(gunlukYolu('/api/ban-list/cok-gizli-token')).toBe('/api/ban-list/***');
  });
});
