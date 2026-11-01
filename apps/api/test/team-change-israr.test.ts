import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Yetkili switch'i ISRARLA denemeli.
 *
 * Squad `AdminForceTeamChange`'i KABUL EDİP oyuncuyu taşımayabiliyor:
 * oyuncu spawn ekranındaysa, ölüm anındaysa ya da sunucunun kendi denge
 * kilidi devredeyse. Sebeplerin çoğu geçici — ilk denemede olmayan
 * saniyeler sonra oluyor.
 *
 * Eskiden tek deneme vardı ve sonuç doğrulanmadan günlüğe "ok" yazılıyordu.
 * İkisi birlikte şunu üretiyordu: yetkili panelde "geçirildi" görüyor,
 * oyuncu eski takımında duruyor ve günlük de yetkiliyi doğruluyor. Hata
 * hiçbir yerde görünmüyordu.
 */

const komutGonder = vi.fn();
const sunucuyuTazele = vi.fn((..._a: unknown[]) => Promise.resolve(true));
const getServerState = vi.fn();
const applyTeamChange = vi.fn();
const kaydet = vi.fn();

vi.mock('../src/lib/agent-command-bus.js', () => ({
  komutGonder: (...a: unknown[]) => komutGonder(...a),
}));
vi.mock('../src/lib/player-refresh.js', () => ({
  sunucuyuTazele: (...a: unknown[]) => sunucuyuTazele(...a),
}));
vi.mock('../src/lib/server-state.js', () => ({
  getServerState: (...a: unknown[]) => getServerState(...a),
  applyTeamChange: (...a: unknown[]) => applyTeamChange(...a),
}));
vi.mock('../src/lib/activity-log.js', () => ({
  kaydet: (...a: unknown[]) => kaydet(...a),
}));
vi.mock('../src/lib/panel-komut-izi.js', () => ({ panelKomutuIsaretle: vi.fn() }));

const { simdiDegistir } = await import('../src/lib/team-change.js');

const STEAM = '76561198052840979';
const hedef = { steamId: STEAM, name: 'Bozkurt', teamId: 1, playerId: 'p1' };
const aktor = { userId: 'u1', name: 'Yalnızkurt' };

/** Oyuncunun o anki takımını belirler (doğrulama bunu okuyor). */
const takimdaGoster = (teamId: number | null) =>
  getServerState.mockReturnValue({ players: [{ steamId: STEAM, teamId }] });

beforeEach(() => {
  vi.clearAllMocks();
  sunucuyuTazele.mockResolvedValue(true);
  komutGonder.mockResolvedValue({ durum: 'ok' });
});

describe('ısrarlı switch', () => {
  it('ilk denemede tutarsa tekrar denemiyor', async () => {
    takimdaGoster(2);
    const sonuc = await simdiDegistir('squad-01', [hedef], 2, undefined, aktor);
    expect(sonuc[0]?.durum).toBe('ok');
    // Biri uyarı, biri forceTeamChange.
    expect(komutGonder.mock.calls.filter((c) => c[1] === 'forceTeamChange')).toHaveLength(1);
  });

  it('ilk deneme TUTMAZSA yeniden gönderiyor ve sonunda başarılı oluyor', async () => {
    // İlk doğrulamada hâlâ eski takımda, ikincisinde hedefte.
    getServerState
      .mockReturnValueOnce({ players: [{ steamId: STEAM, teamId: 1 }] })
      .mockReturnValue({ players: [{ steamId: STEAM, teamId: 2 }] });

    const sonuc = await simdiDegistir('squad-01', [hedef], 2, undefined, aktor);

    expect(sonuc[0]?.durum, 'ikinci deneme tuttuğu hâlde başarısız raporlanıyor').toBe('ok');
    expect(
      komutGonder.mock.calls.filter((c) => c[1] === 'forceTeamChange'),
      'tutmayan switch yeniden denenmiyor',
    ).toHaveLength(2);
  });

  it('hiç tutmazsa dogrulanamadi diyor — "ok" demiyor', async () => {
    takimdaGoster(1); // hep eski takımda
    const sonuc = await simdiDegistir('squad-01', [hedef], 2, undefined, aktor);
    expect(sonuc[0]?.durum).toBe('dogrulanamadi');
    // Üç deneme hakkının hepsi kullanılmış olmalı.
    expect(komutGonder.mock.calls.filter((c) => c[1] === 'forceTeamChange')).toHaveLength(3);
  });

  it('oyuncu ZATEN hedefteyse komut hiç gitmiyor', async () => {
    takimdaGoster(2);
    const sonuc = await simdiDegistir('squad-01', [{ ...hedef, teamId: 2 }], 2, undefined, aktor);
    expect(sonuc[0]?.durum).toBe('zaten_hedefte');
    // Komut göndermek onu hedeften ÇIKARIRDI.
    expect(komutGonder.mock.calls.filter((c) => c[1] === 'forceTeamChange')).toHaveLength(0);
  });

  it('oyuncuya uyarı BİR KEZ gidiyor, her denemede değil', async () => {
    takimdaGoster(1); // hiç tutmuyor -> üç deneme
    await simdiDegistir('squad-01', [hedef], 2, 'sebep', aktor);
    expect(
      komutGonder.mock.calls.filter((c) => c[1] === 'warn'),
      'tekrar denemede oyuncuya üç ayrı uyarı gidiyor',
    ).toHaveLength(1);
  });
});

describe('günlük doğrulanmış sonucu yazıyor', () => {
  /**
   * Kayıt eskiden döngünün İÇİNDE, doğrulamadan önce yazılıyordu: günlük
   * yapısal olarak `dogrulanamadi` yazamıyordu. "Switch çalışıyor mu"
   * sorusu günlüğe bakarak cevaplanamıyordu — canlıda 65 kaydın hepsi
   * "ok" görünüyordu.
   */
  it('taşınmadıysa günlüğe ok DEĞİL dogrulanamadi düşüyor', async () => {
    takimdaGoster(1);
    await simdiDegistir('squad-01', [hedef], 2, undefined, aktor);
    const kayitlar = kaydet.mock.calls.map((c) => c[0] as { payload: { sonuc: string } });
    expect(kayitlar).toHaveLength(1);
    expect(kayitlar[0]?.payload.sonuc, 'günlük gerçekleşmemiş bir geçişi "ok" yazıyor').toBe(
      'dogrulanamadi',
    );
  });

  it('taşındıysa günlüğe ok düşüyor ve kaçıncı denemede olduğu yazıyor', async () => {
    getServerState
      .mockReturnValueOnce({ players: [{ steamId: STEAM, teamId: 1 }] })
      .mockReturnValue({ players: [{ steamId: STEAM, teamId: 2 }] });
    await simdiDegistir('squad-01', [hedef], 2, undefined, aktor);
    const p = (kaydet.mock.calls[0]?.[0] as { payload: { sonuc: string; deneme: number } }).payload;
    expect(p.sonuc).toBe('ok');
    expect(p.deneme).toBe(2);
  });
});
