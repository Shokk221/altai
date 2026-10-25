import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kickSebebiAl, kickSebebiKaydet, kickSebepIzleriniSifirla } from '../src/kick-sebebi.js';

/**
 * Eklentinin attığı oyuncunun sebebinin akışa taşınması.
 *
 * Squad'ın RCON kick yanıtı sebep taşımıyor; sebebi bilen tek taraf komutu
 * gönderen eklenti. Bu iz olmadan panelin akışında yalnızca "sunucudan
 * atıldı" yazıyordu ve moderatör oyuncunun neden atıldığını hiçbir yerden
 * öğrenemiyordu. Yanlış eşleşme ise daha kötü: oyuncuya ait olmayan bir
 * sebep göstermek, olmayan bir ihlali kayda geçirmek olurdu.
 */

beforeEach(() => {
  kickSebepIzleriniSifirla();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const EOS = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const STEAM = '76561198000000001';

describe('kick sebebi izi', () => {
  it('EOS ile kaydedilen sebebi EOS ile bulur', () => {
    kickSebebiKaydet(EOS, 'Mangasız kaldın');
    expect(kickSebebiAl(undefined, EOS)).toBe('Mangasız kaldın');
  });

  it('SteamID ile kaydedilen sebebi SteamID ile bulur', () => {
    // Eklentiler EOS'u tercih ediyor ama EOS'u olmayan oyuncuda SteamID'ye
    // düşüyorlar; tek kimliğe bakmak o oyuncuların sebebini kaybederdi.
    kickSebebiKaydet(STEAM, 'Kadro dışı');
    expect(kickSebebiAl(STEAM, undefined)).toBe('Kadro dışı');
  });

  it('büyük/küçük harf farkına takılmaz', () => {
    // EOS onaltılık ve kaynaklar arasında harf durumu değişebiliyor.
    kickSebebiKaydet(EOS.toUpperCase(), 'Oynama süresi yetersiz');
    expect(kickSebebiAl(undefined, EOS.toLowerCase())).toBe('Oynama süresi yetersiz');
  });

  it('izi TÜKETİR — ikinci kick yanlış sebeple görünmez', () => {
    // Asıl tehlike bu: tüketilmezse sonraki sebepsiz bir kick, eski
    // sebebi taşıyıp olmayan bir ihlali kayda geçirirdi.
    kickSebebiKaydet(EOS, 'Mangasız kaldın');
    expect(kickSebebiAl(undefined, EOS)).toBe('Mangasız kaldın');
    expect(kickSebebiAl(undefined, EOS)).toBeNull();
  });

  it('kaydı olmayan oyuncu için null döner', () => {
    // Oyun içinden elle atılan oyuncunun sebebi bizde yok; uydurmuyoruz.
    expect(kickSebebiAl(STEAM, EOS)).toBeNull();
  });

  it('pencere dolduktan sonra sebebi kullanmaz', () => {
    // Çok sonra aynı oyuncu başka bir sebeple atılırsa ESKİ sebep
    // gösterilmemeli.
    kickSebebiKaydet(EOS, 'Mangasız kaldın');
    vi.advanceTimersByTime(21_000);
    expect(kickSebebiAl(undefined, EOS)).toBeNull();
  });

  it('pencere içindeyse kullanır', () => {
    kickSebebiKaydet(EOS, 'Mangasız kaldın');
    vi.advanceTimersByTime(19_000);
    expect(kickSebebiAl(undefined, EOS)).toBe('Mangasız kaldın');
  });

  it('boş sebep ve boş kimlik iz bırakmaz', () => {
    kickSebebiKaydet(EOS, '   ');
    expect(kickSebebiAl(undefined, EOS)).toBeNull();
    kickSebebiKaydet('   ', 'bir sebep');
    expect(kickSebebiAl('   ', undefined)).toBeNull();
  });

  it('iki oyuncunun sebepleri karışmaz', () => {
    const digerEos = 'ffffffffffffffffffffffffffffffff';
    kickSebebiKaydet(EOS, 'Mangasız kaldın');
    kickSebebiKaydet(digerEos, 'Kadro dışı');
    expect(kickSebebiAl(undefined, digerEos)).toBe('Kadro dışı');
    expect(kickSebebiAl(undefined, EOS)).toBe('Mangasız kaldın');
  });

  it('sebebin baş/son boşluğunu kırpar', () => {
    kickSebebiKaydet(EOS, '  Mangasız kaldın  ');
    expect(kickSebebiAl(undefined, EOS)).toBe('Mangasız kaldın');
  });
});
