import { describe, expect, it } from 'vitest';
import { type BanliOyuncu, banliOlanlar, kickSebebi } from '../src/lib/ban-enforcer.js';

/**
 * Ban artık .cfg listesiyle değil, canlı RCON denetimiyle uygulanıyor.
 * Bu eşleştirme yanlış olursa ban SESSİZCE uygulanmaz: hata çıkmaz, oyuncu
 * oynamaya devam eder. O yüzden kimlik karşılaştırmasının sınırları burada.
 */

const ban = (o: Partial<BanliOyuncu>): BanliOyuncu => ({
  playerId: 'p1',
  steamId: null,
  eosId: null,
  reason: 'test',
  expiresAt: null,
  ...o,
});

const EOS = '00021ce5e3fc448f914e503d2616ad6d';
const STEAM = '76561198052840979';

describe('banliOlanlar', () => {
  it('steam kimliğiyle eşleştirir', () => {
    const sonuc = banliOlanlar([{ steamId: STEAM, eosId: null }], [ban({ steamId: STEAM })]);
    expect(sonuc).toHaveLength(1);
  });

  it('eos kimliğiyle eşleştirir', () => {
    const sonuc = banliOlanlar([{ steamId: null, eosId: EOS }], [ban({ eosId: EOS })]);
    expect(sonuc).toHaveLength(1);
  });

  it('EOS büyük/küçük harf farkını yok sayar', () => {
    // Veritabanında küçük harf saklıyoruz; RCON büyük harf döndürürse
    // düz karşılaştırma eşleşmez ve ban hiç uygulanmaz.
    const sonuc = banliOlanlar(
      [{ steamId: null, eosId: EOS.toUpperCase() }],
      [ban({ eosId: EOS })],
    );
    expect(sonuc).toHaveLength(1);
  });

  it('banı olmayan oyuncuya dokunmaz', () => {
    const sonuc = banliOlanlar(
      [{ steamId: '76561190000000000', eosId: null }],
      [ban({ steamId: STEAM })],
    );
    expect(sonuc).toHaveLength(0);
  });

  it('aynı oyuncu iki kimlikle eşleşse de bir kez döner', () => {
    // Yoksa aynı kişiye iki kick komutu giderdi.
    const sonuc = banliOlanlar(
      [{ steamId: STEAM, eosId: EOS }],
      [ban({ steamId: STEAM, eosId: EOS })],
    );
    expect(sonuc).toHaveLength(1);
  });

  it('kalabalık listede yalnızca banlıları seçer', () => {
    const online = [
      { steamId: '76561190000000001', eosId: null },
      { steamId: STEAM, eosId: null },
      { steamId: '76561190000000002', eosId: null },
      { steamId: null, eosId: EOS },
    ];
    const banlilar = [ban({ playerId: 'p1', steamId: STEAM }), ban({ playerId: 'p2', eosId: EOS })];
    const sonuc = banliOlanlar(online, banlilar);
    expect(sonuc.map((b) => b.playerId).sort()).toEqual(['p1', 'p2']);
  });

  it('boş girdilerde iş yapmaz', () => {
    expect(banliOlanlar([], [ban({ steamId: STEAM })])).toHaveLength(0);
    expect(banliOlanlar([{ steamId: STEAM, eosId: null }], [])).toHaveLength(0);
  });

  it('kimliksiz oyuncu satırı eşleşmeye yol açmaz', () => {
    // Boş kimlikli bir satır, kimliği boş olan bir banla eşleşmemeli.
    const sonuc = banliOlanlar([{ steamId: null, eosId: null }], [ban({ steamId: null })]);
    expect(sonuc).toHaveLength(0);
  });
});

/**
 * Ban ekranındaki metin.
 *
 * Bu hata SESSİZ: kod tarafında hiçbir şey patlamıyor, yalnızca oyuncu
 * ban ekranında ham "{{expires}}" okuyor. Canlıda böyle çıktı.
 */
describe('kickSebebi', () => {
  const NOW = new Date('2026-10-25T09:00:00.000Z');

  it('{{expires}} yer tutucusunu bitiş tarihiyle doldurur', () => {
    const sonuc = kickSebebi(
      ban({
        reason: 'ARAÇ-9 · Tow mangası açılmalıdır. · Bitiş: {{expires}}',
        expiresAt: new Date('2026-11-01T09:00:00.000Z'),
      }),
      NOW,
    );
    expect(sonuc).not.toContain('{{expires}}');
    expect(sonuc).toContain('2026-11-01');
  });

  it('{{timeLeft}} yer tutucusunu kalan süreyle doldurur', () => {
    const sonuc = kickSebebi(
      ban({
        reason: 'Kalan süre: {{timeLeft}}',
        expiresAt: new Date('2026-10-28T09:00:00.000Z'),
      }),
      NOW,
    );
    expect(sonuc).not.toContain('{{timeLeft}}');
    expect(sonuc).toContain('3 gün');
  });

  it('kalıcı banda yer tutucu yerine "kalıcı" yazar', () => {
    const sonuc = kickSebebi(ban({ reason: 'Hile · Bitiş: {{expires}}', expiresAt: null }), NOW);
    expect(sonuc).toContain('kalıcı');
    expect(sonuc).not.toContain('{{');
  });

  it('satır sonlarını temizler', () => {
    // Çok maddeli kural metni ban listesinde satırı bölerdi.
    const sonuc = kickSebebi(ban({ reason: 'Birinci madde\nİkinci madde' }), NOW);
    expect(sonuc).not.toContain('\n');
  });
});
