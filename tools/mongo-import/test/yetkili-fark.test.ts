import { describe, expect, it } from 'vitest';
import {
  type KaynakListe,
  adminsCfgAyristir,
  cift,
  grantFarki,
  kaynakSagligi,
} from '../src/yetkili-fark.js';

/**
 * Yetkili listesi uzlaştırması.
 *
 * NEDEN BU KADAR TEST: bu araç insanların oyun içi ayrıcalığını veriyor ve
 * ALIYOR. Yanlışı iki yönde de sessiz — fazla verirse yetkisiz birine
 * rezerve slot (ya da daha kötüsü) açılır, fazla alırsa klan üyesi dolu
 * sunucuya giremez ve sebebini kimse bilmez.
 *
 * Kaynak dosya bizim değil: eski sistemin halka açık adresinden iniyor.
 * Yarım inmiş, boşalmış ya da biçimi değişmiş bir dosyayı "eski sistem
 * herkesi silmiş" diye okumak buradaki en pahalı hata.
 */

const CFG = [
  '// eski sistemin başlığı',
  'Group=SuperAdmin:cheat,kick,ban,reserve',
  'Group=KlanWL:reserve',
  'Group=SquadLeadPerm:',
  'Group=SeedWL:reserve // seed whitelist',
  'Admin=76561198000000001:KlanWL // Ahmet',
  'Admin=0002eaff43e44e6cb95207bab755c353:SuperAdmin // Dozer',
  'Admin=76561198000000002:SeedWL',
  '',
].join('\n');

const liste = (o: Partial<KaynakListe> = {}): KaynakListe => ({
  gruplar: [{ ad: 'KlanWL', yetkiler: 'reserve' }],
  uyeler: [{ kimlik: '76561198000000001', grup: 'KlanWL' }],
  anlasilmayan: [],
  ...o,
});

describe('adminsCfgAyristir', () => {
  it('grup ve üye satırlarını ayırıyor', () => {
    const k = adminsCfgAyristir(CFG);
    expect(k.gruplar.map((g) => g.ad)).toEqual(['SuperAdmin', 'KlanWL', 'SquadLeadPerm', 'SeedWL']);
    expect(k.uyeler).toHaveLength(3);
    expect(k.anlasilmayan).toEqual([]);
  });

  it('yetkisi boş grubu (SquadLeadPerm) kaybetmiyor', () => {
    // Canlıda böyle bir grup var: `Group=SquadLeadPerm:` — iki nokta
    // üst üsteden sonrası boş. Düşürülürse 4 kişi grupsuz kalır.
    const g = adminsCfgAyristir(CFG).gruplar.find((x) => x.ad === 'SquadLeadPerm');
    expect(g).toEqual({ ad: 'SquadLeadPerm', yetkiler: '' });
  });

  it('satır sonundaki yorumu yetkilere karıştırmıyor', () => {
    const g = adminsCfgAyristir(CFG).gruplar.find((x) => x.ad === 'SeedWL');
    expect(g?.yetkiler).toBe('reserve');
  });

  it('üyenin notunu okuyor, yoksa alan koymuyor', () => {
    const u = adminsCfgAyristir(CFG).uyeler;
    expect(u[0]?.not).toBe('Ahmet');
    expect(u[2]?.not).toBeUndefined();
  });

  it('EOS ve SteamID kimliklerinin ikisini de alıyor', () => {
    const u = adminsCfgAyristir(CFG).uyeler;
    expect(u[1]?.kimlik).toBe('0002eaff43e44e6cb95207bab755c353');
    expect(u[0]?.kimlik).toBe('76561198000000001');
  });

  /**
   * Biçim değişikliği en sinsi senaryo: dosya iniyor, HTTP 200, boyut
   * makul — ama satırların hiçbiri tanınmıyor ve liste "boşalmış" görünüyor.
   */
  it('tanımadığı satırı sessizce atmıyor', () => {
    const k = adminsCfgAyristir('Admin 76561198000000001 KlanWL\nAdmin=x:Y');
    expect(k.anlasilmayan).toEqual(['Admin 76561198000000001 KlanWL']);
  });
});

describe('kaynakSagligi', () => {
  it('olağan listeye izin veriyor', () => {
    expect(kaynakSagligi(adminsCfgAyristir(CFG), 3).guvenli).toBe(true);
  });

  it('üyesi olmayan kaynağı reddediyor', () => {
    const k = kaynakSagligi(liste({ uyeler: [] }), 500);
    expect(k.guvenli).toBe(false);
    expect(k.gerekce).toContain('hiç üye');
  });

  it('grup tanımı olmayan kaynağı reddediyor', () => {
    const k = kaynakSagligi(liste({ gruplar: [] }), 500);
    expect(k.guvenli).toBe(false);
    expect(k.gerekce).toContain('hiç grup');
  });

  /**
   * Bozuk satırda eşik ORANDA: biçim değişikliği yığını bozar, veri giriş
   * hatası tek satırı. İkisini ayırmayan bir kural ya aracı tek yazım
   * hatasıyla kilitler ya da biçim değişikliğini kaçırır.
   */
  it('bozuk satır yığınını reddediyor', () => {
    const k = kaynakSagligi(liste({ anlasilmayan: ['Admin 123 KlanWL'] }), 1);
    expect(k.guvenli).toBe(false);
    expect(k.gerekce).toContain('ayrıştırılamadı');
  });

  it('tek bozuk satırı geçiriyor (canlıda böyle bir satır var)', () => {
    // Gerçek satır: kimlik alanına isim, yoruma SteamID yazılmış. Squad da
    // okuyamıyor; bu yüzden tek başına uzlaştırmayı durdurmamalı.
    const uyeler = Array.from({ length: 548 }, (_, i) => ({
      kimlik: String(i),
      grup: 'KlanWL',
    }));
    const k = kaynakSagligi(
      liste({ uyeler, anlasilmayan: ['Admin=PARMAKSIZ Veteran:VeteranWL //76561198427772079'] }),
      488,
    );
    expect(k.guvenli, k.gerekce).toBe(true);
  });

  it('bozuk satır eşiği aşarsa yine duruyor', () => {
    const uyeler = Array.from({ length: 100 }, (_, i) => ({
      kimlik: String(i),
      grup: 'KlanWL',
    }));
    // 100 üye + 1 grup + 5 bozuk = 106 satır, %4.7 -> eşiğin üstünde.
    const anlasilmayan = Array.from({ length: 5 }, (_, i) => `Admin ${i} KlanWL`);
    const k = kaynakSagligi(liste({ uyeler, anlasilmayan }), 100);
    expect(k.guvenli).toBe(false);
    expect(k.gerekce).toContain('ayrıştırılamadı');
  });

  it('yarım inmiş dosyayı reddediyor', () => {
    const uyeler = Array.from({ length: 100 }, (_, i) => ({
      kimlik: String(i),
      grup: 'KlanWL',
    }));
    const k = kaynakSagligi(liste({ uyeler }), 500);
    expect(k.guvenli).toBe(false);
    expect(k.gerekce).toContain('yarım');
  });

  it('bizde hiç kayıt yokken ilk doldurmaya izin veriyor', () => {
    expect(kaynakSagligi(liste(), 0).guvenli).toBe(true);
  });
});

describe('grantFarki', () => {
  it('eklenecek, düşecek ve aynı olanı ayırıyor', () => {
    const f = grantFarki(
      [cift('a', 'KlanWL'), cift('b', 'KlanWL')],
      [cift('a', 'KlanWL'), cift('c', 'KlanWL')],
    );
    expect(f.eklenecek).toEqual([cift('b', 'KlanWL')]);
    expect(f.dusecek).toEqual([cift('c', 'KlanWL')]);
    expect(f.ayni).toBe(1);
  });

  /**
   * Birim kişi DEĞİL, kişi+grup. Aynı kişi birden fazla whitelist'te
   * olabiliyor; kişi bazında karşılaştırsak "hâlâ listede" diye tek
   * grubun kaldırıldığını kaçırırdık.
   */
  it('aynı kişinin tek grubunun kaldırılmasını yakalıyor', () => {
    const f = grantFarki([cift('a', 'KlanWL')], [cift('a', 'KlanWL'), cift('a', 'VeteranWL')]);
    expect(f.dusecek).toEqual([cift('a', 'VeteranWL')]);
    expect(f.eklenecek).toEqual([]);
  });

  it('eşiğin altındaki düşürme onay istemiyor', () => {
    const bizdeki = Array.from({ length: 100 }, (_, i) => cift(String(i), 'KlanWL'));
    // 100 kayıttan 100'ü kaynakta da var, 1 fazlamız düşecek -> %1
    const kaynak = bizdeki.slice(0, 99);
    expect(grantFarki(kaynak, bizdeki).onayGerekli).toBe(false);
  });

  it('eşiği aşan düşürme onay istiyor', () => {
    const bizdeki = Array.from({ length: 100 }, (_, i) => cift(String(i), 'KlanWL'));
    const kaynak = bizdeki.slice(0, 70); // 30 düşecek -> %30
    const f = grantFarki(kaynak, bizdeki);
    expect(f.dusecek).toHaveLength(30);
    expect(f.onayGerekli).toBe(true);
  });

  it('bizde hiç kayıt yokken onay istemiyor', () => {
    expect(grantFarki([cift('a', 'KlanWL')], []).onayGerekli).toBe(false);
  });
});
