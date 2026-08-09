import { describe, expect, it } from 'vitest';
import { banAktifMi } from '../src/lib/ban-active.js';

/**
 * "Ban geçerli mi" kuralı, oyuncunun sunucuya girip giremeyeceğini belirliyor.
 * Kural üç yerde ayrı ayrı yazılmıştı (ban listesi sorgusu, liste render'ı,
 * oyuncu profili); tek tanıma indirildi ve sınır durumları buraya kilitlendi.
 */

const SIMDI = new Date('2026-08-10T12:00:00.000Z');
const gecmis = new Date('2026-08-10T11:59:59.000Z');
const gelecek = new Date('2026-08-10T12:00:01.000Z');

describe('banAktifMi', () => {
  it('kalıcı ban her zaman geçerli', () => {
    expect(banAktifMi({ revokedAt: null, expiresAt: null }, SIMDI)).toBe(true);
  });

  it('bitişi gelecekte olan ban geçerli', () => {
    expect(banAktifMi({ revokedAt: null, expiresAt: gelecek }, SIMDI)).toBe(true);
  });

  it('bitişi geçmişte olan ban geçersiz', () => {
    expect(banAktifMi({ revokedAt: null, expiresAt: gecmis }, SIMDI)).toBe(false);
  });

  it('TAM bitiş anında ban artık geçerli değil', () => {
    // Sınır kasıtlı: `gt` kullanılıyor, `gte` değil. Ban listesi sorgusu da
    // aynı sınırı kullanmalı, yoksa panel "bitti" derken sunucu oyuncuyu
    // hâlâ engelliyor olur.
    expect(banAktifMi({ revokedAt: null, expiresAt: SIMDI }, SIMDI)).toBe(false);
  });

  it('kaldırılmış ban, bitişi gelecekte olsa da geçersiz', () => {
    expect(banAktifMi({ revokedAt: gecmis, expiresAt: gelecek }, SIMDI)).toBe(false);
  });

  it('kaldırılmış kalıcı ban geçersiz', () => {
    expect(banAktifMi({ revokedAt: gecmis, expiresAt: null }, SIMDI)).toBe(false);
  });

  it('kaldırma, bitişten önce gelse de sonuç değişmez', () => {
    // revoked_at'in bitişten sonra olması mantıksız ama veri BM'den geliyor;
    // tutarsız veride bile "kaldırılmış" kazanmalı.
    expect(banAktifMi({ revokedAt: gelecek, expiresAt: gelecek }, SIMDI)).toBe(false);
  });
});
