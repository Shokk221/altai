import { describe, expect, it } from 'vitest';
import SquadRcon from '../vendor/squad-server/rcon.js';

/**
 * ListPlayers ayrıştırması — vendored SquadJS'in `getListPlayers()` metodu.
 *
 * NEDEN BU TESTİN VAR OLMASI GEREKİYOR: bu tek regex iki günde ÜÇ kez
 * değişti (rol sonundaki virgül, Squad 10.6'nın Party ID alanı, teamID
 * genişliği) ve her seferinde elle doğrulandı. Üçüncüsünde yanlış da
 * yapıldı: `\d+` yerine `\d` commit'lenince iki haneli takım kimliği
 * taşıyan satır hiç eşleşmiyordu.
 *
 * Hatanın sessiz olması esas tehlike. Eşleşmeyen satır
 * `if (!match) continue;` ile atlanıyor — ne istisna, ne log, ne de
 * bozuk bir alan. Oyuncu yalnızca listeden YOK oluyor. Panelde "canlı
 * oyuncu listesi eksik" diye görünür ama sebebi hiçbir yerde yazmaz.
 * Bunu yakalayabilecek tek şey test.
 *
 * Vendored dosyaya DOKUNULMUYOR: gerçek metot, `execute` taklit edilerek
 * koşturuluyor. Böylece regex'in yanında tip dönüşümleri (`+playerID`,
 * `'True'` -> true, `'N/A'` -> null) ve kimlik ayrıştırması da aynı
 * yolda ölçülüyor. Regex'i metin olarak çekip ayrıca denemek, kodun
 * kendisini değil kopyasını test etmek olurdu.
 */

interface AyrismisOyuncu {
  playerID: number;
  name: string;
  teamID: number | null;
  squadID: number | null;
  isLeader: boolean;
  role: string;
  steamID?: string;
  eosID?: string;
}

/** Gerçek `getListPlayers()`'ı RCON'a hiç gitmeden koşturur. */
async function ayristir(yanit: string): Promise<AyrismisOyuncu[]> {
  // Kurucu bağlantı AÇMIYOR, yalnızca alanları atıyor (core/rcon.js);
  // bağlanma `connect()` ile oluyor ve onu hiç çağırmıyoruz.
  const rcon = new (SquadRcon as new (o: unknown) => unknown)({
    host: '127.0.0.1',
    port: 21114,
    password: 'test',
  }) as { execute: (k: string) => Promise<string>; getListPlayers: () => Promise<unknown[]> };

  rcon.execute = async (komut: string) => (komut === 'ListPlayers' ? yanit : '');
  return (await rcon.getListPlayers()) as AyrismisOyuncu[];
}

const KIMLIK = 'EOS: 0002aa11bb22cc33dd44ee55ff66aa77 steam: 76561198000000001';

/** Squad 10.6: Team ID ile Squad ID arasında Party ID, sonda Vehicle. */
const SATIR_106 = `ID: 12 | Online IDs: ${KIMLIK} | Name: Oyuncu | Team ID: 2 | Party ID: 3 | Squad ID: 4 | Is Leader: True | Role: WPMC_Rifleman_01 | Vehicle: BTR82A`;
/** 10.6 öncesi: Party ID alanı hiç yok. */
const SATIR_ESKI = `ID: 7 | Online IDs: ${KIMLIK} | Name: Veli | Team ID: 1 | Squad ID: 2 | Is Leader: True | Role: WPMC_SL_01`;

describe('getListPlayers — biçim uyumu', () => {
  it('Squad 10.6 satırını (Party ID + Vehicle) ayrıştırır', async () => {
    const [o] = await ayristir(SATIR_106);
    expect(o).toMatchObject({
      playerID: 12,
      name: 'Oyuncu',
      teamID: 2,
      squadID: 4,
      isLeader: true,
      role: 'WPMC_Rifleman_01',
    });
  });

  it('10.6 ÖNCESİ satırı da ayrıştırır', async () => {
    // Party ID opsiyonel tutuldu: iki biçim bir arada çalışmalı, yoksa
    // sunucu sürümü düşürüldüğünde liste tamamen boşalırdı.
    const [o] = await ayristir(SATIR_ESKI);
    expect(o).toMatchObject({ playerID: 7, name: 'Veli', teamID: 1, squadID: 2 });
  });

  it('İKİ HANELİ takım kimliğini kabul eder', async () => {
    // Regresyon koruması: `(?<teamID>\d|N\/A)` ile bu satır HİÇ
    // eşleşmiyordu ve oyuncu listeden sessizce düşüyordu (commit
    // e8c413d -> 771ff00). Vanilla Squad'da takımlar 1 ve 2, ama
    // daraltmanın bedeli sessiz veri kaybı olduğu için genişliği
    // burada kilitliyoruz.
    const satir = `ID: 3 | Online IDs: ${KIMLIK} | Name: Oyuncu | Team ID: 10 | Party ID: 1 | Squad ID: 2 | Is Leader: True | Role: WPMC_Rifleman_01`;
    const oyuncular = await ayristir(satir);
    expect(oyuncular).toHaveLength(1);
    expect(oyuncular[0]?.teamID).toBe(10);
  });

  it('Party ID: N/A satırını ayrıştırır', async () => {
    const satir = `ID: 4 | Online IDs: ${KIMLIK} | Name: Ali | Team ID: 1 | Party ID: N/A | Squad ID: 3 | Is Leader: False | Role: WPMC_Medic_01`;
    const [o] = await ayristir(satir);
    expect(o).toMatchObject({ teamID: 1, squadID: 3, isLeader: false });
  });

  it('rol sonundaki virgülü yutar', async () => {
    // Sunucu yük altındayken rol adının sonuna virgül ekliyor.
    const satir = `ID: 5 | Online IDs: ${KIMLIK} | Name: Ali | Team ID: 1 | Squad ID: 1 | Is Leader: True | Role: WPMC_Rifleman_01,`;
    const [o] = await ayristir(satir);
    expect(o?.role).toBe('WPMC_Rifleman_01');
  });

  it('isminde "|" olan oyuncuyu doğru ayrıştırır', async () => {
    // Klan etiketleri boru işareti içerebiliyor ("ACC | BL4CK"); isim
    // alanı açgözlü olmasaydı satır yanlış bölünürdü.
    const satir = `ID: 6 | Online IDs: ${KIMLIK} | Name: ACC | BL4CK | Team ID: 2 | Party ID: 1 | Squad ID: 3 | Is Leader: False | Role: WPMC_LAT_01`;
    const [o] = await ayristir(satir);
    expect(o?.name).toBe('ACC | BL4CK');
    expect(o?.teamID).toBe(2);
  });
});

describe('getListPlayers — tip dönüşümleri', () => {
  it('sayısal alanları SAYIYA, lider alanını BOOLEAN’a çevirir', async () => {
    // Panel bu alanları doğrudan kullanıyor; string kalsalar takım
    // karşılaştırmaları (teamID === 1) sessizce false dönerdi.
    const [o] = await ayristir(SATIR_106);
    expect(typeof o?.playerID).toBe('number');
    expect(typeof o?.teamID).toBe('number');
    expect(typeof o?.squadID).toBe('number');
    expect(o?.isLeader).toBe(true);
  });

  it('"N/A" takım ve mangayı NULL yapar — sıfır değil', async () => {
    // 0 geçerli bir manga kimliği olabilir; "mangası yok" ile
    // "manga 0" karıştırılırsa mangasız oyuncu atan eklenti yanlış
    // kişiyi atardı.
    const satir = `ID: 8 | Online IDs: ${KIMLIK} | Name: Ali | Team ID: N/A | Squad ID: N/A | Is Leader: False | Role: WPMC_Rifleman_01`;
    const [o] = await ayristir(satir);
    expect(o?.teamID).toBeNull();
    expect(o?.squadID).toBeNull();
  });

  it('Steam ve EOS kimliklerini ayırır', async () => {
    const [o] = await ayristir(SATIR_106);
    expect(o?.steamID).toBe('76561198000000001');
    expect(o?.eosID).toBe('0002aa11bb22cc33dd44ee55ff66aa77');
  });
});

describe('getListPlayers — sessiz düşmeye karşı', () => {
  it('karışık bir listede HİÇBİR satırı kaybetmez', async () => {
    // Asıl koruma bu: regex daralırsa istisna değil EKSİK LİSTE üretir.
    // Sayıyı kilitlemek, bozulmayı tek tek alan iddialarından daha
    // güvenilir yakalıyor.
    const yanit = [
      SATIR_106,
      SATIR_ESKI,
      `ID: 9 | Online IDs: ${KIMLIK} | Name: Ayşe | Team ID: 10 | Party ID: N/A | Squad ID: N/A | Is Leader: False | Role: USA_Medic_01,`,
    ].join('\n');

    const oyuncular = await ayristir(yanit);
    expect(oyuncular).toHaveLength(3);
    expect(oyuncular.map((o) => o.playerID)).toEqual([12, 7, 9]);
  });

  it('ayrıştırılamayan satır listeyi bozmaz, yalnızca kendisi atlanır', async () => {
    // RCON yanıtı başlık/boş satır da taşıyor; bunların oyuncu sanılması
    // ya da tüm ayrıştırmayı durdurması olmaz.
    const yanit = ['----- Active Players -----', '', SATIR_106, 'bozuk satir'].join('\n');
    const oyuncular = await ayristir(yanit);
    expect(oyuncular).toHaveLength(1);
    expect(oyuncular[0]?.playerID).toBe(12);
  });

  it('boş yanıtta boş liste döner', async () => {
    expect(await ayristir('')).toEqual([]);
  });
});
