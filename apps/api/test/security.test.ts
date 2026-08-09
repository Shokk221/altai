import { describe, expect, it } from 'vitest';
import { redactUrl, redactedRequestSerializer } from '../src/lib/log-redact.js';
import { timingSafeCompare } from '../src/lib/timing-safe.js';

/**
 * Bu testler gerçek kurulumda bulunan sorunları kilitliyor. Sızıntı canlı
 * sistemin loglarında doğrulandı, sonra düzeltildi — regresyonu buradan
 * yakalıyoruz.
 */

describe('redactUrl', () => {
  it("ban listesi token'ını maskeler", () => {
    // Hatanın kaynağı: token her istekte düz metin loglanıyordu. Buradaki
    // değer UYDURMA olmalı — bir zamanlar gerçek token yazılıydı ve depo
    // herkese açık olduğu için sızdı. Teste asla canlı sır konmaz.
    const real = `/ban-list/${'0'.repeat(48)}.cfg`;
    const out = redactUrl(real);
    expect(out).toBe('/ban-list/***');
    expect(out).not.toContain('0000');
  });

  it('sorgu parametresi olsa da maskeler', () => {
    const out = redactUrl('/ban-list/abc123secret.cfg?server=squad-01');
    expect(out).not.toContain('abc123secret');
    expect(out).toContain('server=squad-01');
  });

  it('yaygın sır isimli sorgu parametrelerini maskeler', () => {
    expect(redactUrl('/x?token=abc')).toBe('/x?token=***');
    expect(redactUrl('/x?a=1&secret=zzz&b=2')).toBe('/x?a=1&secret=***&b=2');
    expect(redactUrl('/x?password=hunter2')).toBe('/x?password=***');
  });

  it("zararsız URL'lere dokunmaz", () => {
    expect(redactUrl('/servers/squad-01')).toBe('/servers/squad-01');
    expect(redactUrl('/health')).toBe('/health');
  });
});

describe('redactedRequestSerializer', () => {
  it('url maskeli, diğer alanlar korunur', () => {
    const out = redactedRequestSerializer({
      method: 'GET',
      url: '/ban-list/gizlitoken.cfg',
      headers: { host: 'panel.altaisquad.com' },
      socket: { remoteAddress: '10.0.0.1', remotePort: 5000 },
    });
    expect(out.url).toBe('/ban-list/***');
    expect(out.method).toBe('GET');
    expect(out.host).toBe('panel.altaisquad.com');
    expect(out.remoteAddress).toBe('10.0.0.1');
  });

  it('tanımsız alanları nesneye hiç koymaz', () => {
    const out = redactedRequestSerializer({ url: '/health' });
    expect('method' in out).toBe(false);
    expect('remoteAddress' in out).toBe(false);
  });
});

describe('timingSafeCompare', () => {
  it('aynı değerler için true', () => {
    expect(timingSafeCompare('gizli-deger', 'gizli-deger')).toBe(true);
  });

  it('farklı değerler için false', () => {
    expect(timingSafeCompare('gizli-deger', 'baska-deger')).toBe(false);
  });

  it('farklı uzunlukta patlamaz', () => {
    // timingSafeEqual eşit olmayan uzunlukta exception atar; sarmalayıcı
    // bunu yakalamalı, yoksa uzunluğu farklı bir token 500'e yol açardı.
    expect(timingSafeCompare('kisa', 'cok-daha-uzun-bir-deger')).toBe(false);
    expect(timingSafeCompare('', 'x')).toBe(false);
  });

  it('boş iki değer eşittir', () => {
    expect(timingSafeCompare('', '')).toBe(true);
  });

  it('çok baytlı karakterlerde doğru çalışır', () => {
    expect(timingSafeCompare('şifre', 'şifre')).toBe(true);
    expect(timingSafeCompare('şifre', 'sifre')).toBe(false);
  });
});
