import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { izinleriBirlestir, yetkisizMi } from '../src/lib/roles.js';

/**
 * Panel yetkisi olmayan Discord hesabı GİRİŞ ALMAMALI.
 *
 * Önce herkes giriyordu: eşleşmeyen hesap `member` + boş izinle panele
 * alınıyordu. Yetki her EYLEMDE kontrol ediliyordu ama GÖRMEK bir eylem
 * değil — sunucudaki herhangi bir üye oyuncu listesini ve canlı durumu
 * açabiliyordu.
 *
 * Sınır ince: "izni yok" ile "yetkisi yok" aynı şey değil. İzin listesi
 * boş ama sistem rolü `admin` olan bir eşleme gerçek bir yetkidir.
 */

const KOK = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const authKaynak = readFileSync(`${KOK}/routes/auth.ts`, 'utf8');

describe('yetkisizMi', () => {
  it('hiç eşleme yoksa yetkisiz', () => {
    expect(yetkisizMi(izinleriBirlestir([]))).toBe(true);
  });

  it('member + boş izin veren eşleme de yetkisiz — hiçbir şey vermiyor', () => {
    expect(yetkisizMi(izinleriBirlestir([{ systemRole: 'member', panelPermissions: [] }]))).toBe(
      true,
    );
  });

  it('izni olan member YETKİLİ', () => {
    expect(
      yetkisizMi(izinleriBirlestir([{ systemRole: 'member', panelPermissions: ['player.ban'] }])),
    ).toBe(false);
  });

  /**
   * SINIR DURUM: izin listesi boş ama sistem rolü yüksek. Yalnızca
   * izinlere bakan bir kontrol burada yanılır ve gerçek bir yetkiliyi
   * kapıda bırakırdı.
   */
  it('izinsiz admin YETKİLİ — rolün kendisi bir yetki', () => {
    expect(yetkisizMi(izinleriBirlestir([{ systemRole: 'admin', panelPermissions: [] }]))).toBe(
      false,
    );
  });

  it('super_admin yetkili', () => {
    expect(
      yetkisizMi(izinleriBirlestir([{ systemRole: 'super_admin', panelPermissions: [] }])),
    ).toBe(false);
  });
});

describe('giriş yolu kontrolü uyguluyor', () => {
  // SINIRI AÇIK: metin arıyor, davranış ölçmüyor. Discord OAuth akışını
  // uçtan uca koşturmak gerçek bir Discord sunucusu isterdi.
  it('callback yetkisizMi çağırıyor', () => {
    expect(
      authKaynak,
      'Discord callback yetki kontrolü yapmıyor: yetkisiz hesap panele girer.',
    ).toContain('yetkisizMi(');
  });

  /**
   * SIRA ÖNEMLİ. Kontrol oturum yazıldıktan sonra yapılırsa çerez çoktan
   * verilmiş olur ve reddetmenin bir anlamı kalmaz.
   */
  it('kontrol oturum açmadan ÖNCE yapılıyor', () => {
    const kontrol = authKaynak.indexOf('yetkisizMi(');
    const oturum = authKaynak.indexOf('await createSession(');
    expect(kontrol, 'yetkisizMi bulunamadı').toBeGreaterThan(-1);
    expect(oturum, 'createSession bulunamadı').toBeGreaterThan(-1);
    expect(kontrol, 'yetki kontrolü oturum açıldıktan SONRA yapılıyor').toBeLessThan(oturum);
  });

  /**
   * Break-glass kapıda kalmamalı: rol eşlemeleri yanlışlıkla silinirse
   * panele girilip düzeltilebilecek tek yol o.
   */
  it('break-glass girişi kontrolden etkilenmiyor', () => {
    const bg = authKaynak.indexOf("systemRole: 'super_admin'");
    expect(bg, 'break-glass yolu bulunamadı').toBeGreaterThan(-1);
    // Kontrol yalnızca Discord callback'inde; break-glass ondan sonra
    // geliyor ve kendi oturumunu açıyor.
    expect(authKaynak.slice(bg)).not.toContain('yetkisizMi(');
  });
});
