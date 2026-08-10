import { describe, expect, it } from 'vitest';
import { komutUlasti } from '../src/lib/agent-command-bus.js';

/**
 * Uyarı teslimi.
 *
 * Panelden uyarı verildiğinde kayıt yazılıyordu ama oyuncu oyunda hiçbir şey
 * görmüyordu — agent'a komut hiç gitmiyordu ve `delivered_at` hep boş
 * kalıyordu. Komut artık gönderiliyor; bu testler "teslim edildi sayılır mı"
 * kararını kilitliyor.
 *
 * Kural: uyarının KAYDI, iletilmesinden bağımsız olarak geçerlidir. Teslim
 * edilememesi bir hata değil, yalnızca `delivered_at`'in boş kalmasıdır.
 */

describe('komutUlasti', () => {
  it('en az bir sunucu ok döndüyse ulaşmış sayılır', () => {
    expect(komutUlasti({ 'squad-01': 'ok' })).toBe(true);
  });

  it('sunuculardan biri ok ise diğerlerinin durumu önemsiz', () => {
    // Oyuncu tek sunucuda; diğerlerinde "bulunamadı" ya da agent kopuk
    // olması normal. Uyarı ulaştı.
    expect(
      komutUlasti({ 'squad-01': 'agent_yok', 'squad-02': 'ok', 'squad-03': 'zaman_asimi' }),
    ).toBe(true);
  });

  it('hiçbir agent bağlı değilse ulaşmamıştır', () => {
    // Bu bir HATA DEĞİL: kayıt yazıldı, sadece oyuncu göremedi.
    expect(komutUlasti({ 'squad-01': 'agent_yok', 'squad-02': 'agent_yok' })).toBe(false);
  });

  it('zaman aşımı ve RCON hatası ulaşma sayılmaz', () => {
    expect(komutUlasti({ 'squad-01': 'zaman_asimi' })).toBe(false);
    expect(komutUlasti({ 'squad-01': 'hata: gecerli_kimlik_yok' })).toBe(false);
    expect(komutUlasti({ 'squad-01': 'hata: rcon_hatasi', 'squad-02': 'zaman_asimi' })).toBe(false);
  });

  it('hiç sunucu yoksa ulaşmamıştır', () => {
    // Boş dizide `some` false döner; yine de açıkça kilitliyoruz, çünkü
    // buradan true dönmesi delivered_at'i sahte yere doldururdu.
    expect(komutUlasti({})).toBe(false);
  });

  it("'ok' ile başlayan ama farklı bir durum başarı sayılmaz", () => {
    // Durumlar tek dizeye indirgeniyor ('hata: ...' gibi). Eşleşme tam
    // olmalı, `startsWith` değil.
    expect(komutUlasti({ 'squad-01': 'okunamadi' })).toBe(false);
  });
});
