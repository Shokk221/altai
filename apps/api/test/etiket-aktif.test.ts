import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { aktifEtiketKosulu, etiketAktifMi, kaldirilmamisKosulu } from '../src/lib/etiket-aktif.js';

/**
 * "Etiket şu an duruyor mu" kuralı, SL ban'ın ne zaman biteceğini
 * belirliyor.
 *
 * NEDEN BU TEST VAR: kural eskiden tek koşuldu (`removed_at is null`) ve
 * YEDİ ayrı yere elle yazılmıştı. SL ban'a süre eklenince (migration 0029)
 * kural ikiye çıktı; yedi kopyadan birini atlamak, süresi dolmuş bir SL
 * ban'ın oyuncuyu hâlâ manga liderliğinden atması demekti — ve bu sessiz
 * olurdu, çünkü hata "yaptırım fazla çalışıyor" biçiminde görünür.
 *
 * Aynı sınıf hata ban tarafında yaşandı (bkz. ban-listesi-valfi.test.ts):
 * kural iki yoldaydı, biri güncellendi, diğeri unutuldu.
 */

const KOK = new URL('../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const oku = (kisa: string) => readFileSync(join(KOK, kisa), 'utf8');
const sql = (k: ReturnType<typeof aktifEtiketKosulu>) => (k ? new PgDialect().sqlToQuery(k) : null);

const SIMDI = new Date('2026-10-25T12:00:00.000Z');
const gecmis = new Date('2026-10-25T11:59:59.000Z');
const gelecek = new Date('2026-10-25T12:00:01.000Z');

describe('etiketAktifMi', () => {
  it('süresiz ve kaldırılmamış etiket aktif', () => {
    expect(etiketAktifMi({ removedAt: null, expiresAt: null }, SIMDI)).toBe(true);
  });

  it('bitişi gelecekte olan etiket aktif', () => {
    expect(etiketAktifMi({ removedAt: null, expiresAt: gelecek }, SIMDI)).toBe(true);
  });

  it('süresi dolan etiket AKTİF DEĞİL — yaptırım kendiliğinden bitmeli', () => {
    expect(etiketAktifMi({ removedAt: null, expiresAt: gecmis }, SIMDI)).toBe(false);
  });

  // Ban tarafıyla aynı sınır: `gt`, `gte` değil.
  it('tam bitiş anında etiket artık aktif değil', () => {
    expect(etiketAktifMi({ removedAt: null, expiresAt: SIMDI }, SIMDI)).toBe(false);
  });

  it('elle kaldırılan etiket, süresi dolmamış olsa bile aktif değil', () => {
    expect(etiketAktifMi({ removedAt: gecmis, expiresAt: gelecek }, SIMDI)).toBe(false);
  });
});

describe('iki soru ayrı tutuluyor', () => {
  /**
   * Okuma ve yazma koşulları karıştırılırsa iki ayrı hata çıkar: yazma
   * koşulu okumada kullanılırsa süresi dolmuş yaptırım sürer; okuma
   * koşulu kaldırmada kullanılırsa yetkili süresi dolmuş bir etiketi
   * kaldıramaz (hiçbir satır eşleşmez).
   */
  it('okuma koşulu süreye BAKAR', () => {
    const q = sql(aktifEtiketKosulu(SIMDI));
    expect(q?.sql).toContain('removed_at');
    expect(q?.sql, 'okuma koşulu bitişi dikkate almıyor').toContain('expires_at');
  });

  it('yazma koşulu süreye BAKMAZ', () => {
    const q = sql(kaldirilmamisKosulu());
    expect(q?.sql).toContain('removed_at');
    expect(q?.sql, 'kaldırma hedefi süreye bakmamalı').not.toContain('expires_at');
  });
});

describe('kural tek yerde duruyor', () => {
  /**
   * EN ÖNEMLİ İDDİA. Koşulun ikinci bir kopyası doğarsa, kural bir daha
   * değiştiğinde biri güncellenip diğeri unutulur — zaten böyle oldu.
   *
   * Sütunun SEÇİLMESİ serbest (profil ekranı `removedAt`'i gösteriyor);
   * yasak olan KOŞUL olarak yazılması.
   */
  function tsDosyalari(dizin: string, biriken: string[] = []): string[] {
    for (const girdi of readdirSync(join(KOK, dizin), { withFileTypes: true })) {
      const yol = `${dizin}/${girdi.name}`;
      if (girdi.isDirectory()) tsDosyalari(yol, biriken);
      else if (girdi.name.endsWith('.ts')) biriken.push(yol);
    }
    return biriken;
  }

  it('flagAssignments.removedAt koşulu yalnızca etiket-aktif.ts içinde', () => {
    const suclu: string[] = [];
    for (const yol of tsDosyalari('.')) {
      if (yol.endsWith('lib/etiket-aktif.ts')) continue;
      if (/isNull\(\s*moderationSchema\.flagAssignments\.removedAt\s*\)/.test(oku(yol))) {
        suclu.push(yol);
      }
    }
    const ipucu =
      'lib/etiket-aktif.ts → aktifEtiketKosulu (okuma) veya kaldirilmamisKosulu (yazma)';
    expect(suclu, `${suclu.join(', ')} koşulu kendi yazıyor, süreyi atlıyor. ${ipucu}`).toEqual([]);
  });

  it('yaptırım yolu (agent-queries) paylaşılan koşulu kullanıyor', () => {
    expect(
      oku('lib/agent-queries.ts'),
      'agent eklentisine etiket döndüren yol süreyi dikkate almıyor: süresi ' +
        'dolmuş SL ban oyuncuyu liderlikten atmaya devam eder.',
    ).toContain('aktifEtiketKosulu(');
  });
});
