import type { AgentEvent } from '@altai/contracts';
import { describe, expect, it } from 'vitest';
import { komutAyristir, komutEslesti } from '../src/chat-command.js';

/**
 * Sohbet komutu ayrıştırma.
 *
 * Dört plugin buna dayanıyor. Yanlış ayrıştırma en görünür hata türü:
 * komut bir kısım oyuncuda sessizce çalışmaz ve sebebi anlaşılmaz.
 */

const mesaj = (
  message: string,
  channel: 'All' | 'Team' | 'Squad' | 'Admin' = 'All',
): Extract<AgentEvent, { type: 'CHAT_MESSAGE' }> => ({
  type: 'CHAT_MESSAGE',
  serverSlug: 'squad-01',
  steamId: '76561190000000001',
  channel,
  message,
  timestamp: new Date().toISOString(),
});

describe('komutAyristir', () => {
  it('komutu ve argümanı ayırır', () => {
    const k = komutAyristir(mesaj('!katıl 3,5'));
    expect(k?.ad).toBe('katıl');
    expect(k?.arguman).toBe('3,5');
  });

  it('argümansız komut kabul edilir', () => {
    const k = komutAyristir(mesaj('!fow'));
    expect(k?.ad).toBe('fow');
    expect(k?.arguman).toBe('');
  });

  it('ön eki olmayan mesaj komut DEĞİLDİR', () => {
    expect(komutAyristir(mesaj('katıl 3'))).toBeNull();
  });

  it('yalnızca ön ek komut değildir', () => {
    expect(komutAyristir(mesaj('!'))).toBeNull();
    expect(komutAyristir(mesaj('!   '))).toBeNull();
  });

  it('baştaki ve sondaki boşluklar önemsiz', () => {
    const k = komutAyristir(mesaj('   !fow   '));
    expect(k?.ad).toBe('fow');
  });

  it('komut adı Türkçe kurallarıyla küçültülür', () => {
    // toLowerCase() İngilizce kuralıyla "KATIL" -> "katil" verir ve
    // `katıl` komutuyla EŞLEŞMEZ. Bu, komutun caps kilidi açık oynayan
    // oyuncularda sessizce çalışmaması demekti.
    const k = komutAyristir(mesaj('!KATIL 3'));
    expect(k?.ad).toBe('katıl');
    expect(komutEslesti(k?.ad ?? '', 'katıl')).toBe(true);
  });

  it('büyük I harfi de doğru küçülür', () => {
    expect(komutAyristir(mesaj('!SICAK'))?.ad).toBe('sıcak');
  });

  it('birden fazla boşluk argümanı bozmaz', () => {
    expect(komutAyristir(mesaj('!katıl    3, 5 , 7'))?.arguman).toBe('3, 5 , 7');
  });

  it('özel ön ek kullanılabilir', () => {
    expect(komutAyristir(mesaj('.fow'), '.')?.ad).toBe('fow');
    expect(komutAyristir(mesaj('!fow'), '.')).toBeNull();
  });

  it('kanal bilgisi taşınır', () => {
    expect(komutAyristir(mesaj('!fow', 'Admin'))?.channel).toBe('Admin');
  });
});

describe('komutEslesti', () => {
  it('ayardaki ön ek yok sayılır', () => {
    // Panelde "!fow" yazan biri komutun çalışmamasını beklemiyor.
    expect(komutEslesti('fow', '!fow')).toBe(true);
  });

  it('ayardaki büyük harf yok sayılır', () => {
    expect(komutEslesti('fow', 'FOW')).toBe(true);
  });

  it('farklı komut eşleşmez', () => {
    expect(komutEslesti('fow', 'randomize')).toBe(false);
  });
});
