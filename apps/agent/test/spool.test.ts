import { appendFileSync, existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AgentEvent } from '@altai/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSpool } from '../src/spool.js';

/**
 * Spool, agent'ın veri kaybına karşı TEK savunması: api düşerse eventler
 * yalnızca burada durur. O yüzden sırayı ve yarıda kesilmeyi test ediyoruz.
 */

function event(n: number): AgentEvent {
  return {
    type: 'PLAYER_CONNECTED',
    serverSlug: 'squad-01',
    steamId: `7656119${n}`,
    name: `Oyuncu${n}`,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
  };
}

describe('spool', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'spool-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('boşken drain hemen başarılı döner', async () => {
    const spool = createSpool({ dir });
    expect(spool.hasPending()).toBe(false);
    expect(await spool.drain(() => true)).toBe(true);
  });

  it('eventleri yazdığı sırayla geri verir', async () => {
    const spool = createSpool({ dir });
    for (let i = 1; i <= 5; i++) await spool.append(event(i));
    expect(spool.hasPending()).toBe(true);

    const sent: string[] = [];
    const done = await spool.drain((e) => {
      sent.push((e as Extract<AgentEvent, { type: 'PLAYER_CONNECTED' }>).name);
      return true;
    });

    expect(done).toBe(true);
    expect(sent).toEqual(['Oyuncu1', 'Oyuncu2', 'Oyuncu3', 'Oyuncu4', 'Oyuncu5']);
    expect(spool.hasPending()).toBe(false);
  });

  it('gönderim ortada kesilirse kalanı diskte tutar ve sonraki denemede kaldığı yerden sürer', async () => {
    const spool = createSpool({ dir });
    for (let i = 1; i <= 5; i++) await spool.append(event(i));

    // 3. eventte bağlantı koptu.
    const firstTry: string[] = [];
    const done = await spool.drain((e) => {
      const name = (e as Extract<AgentEvent, { type: 'PLAYER_CONNECTED' }>).name;
      if (firstTry.length === 2) return false;
      firstTry.push(name);
      return true;
    });

    expect(done).toBe(false);
    expect(firstTry).toEqual(['Oyuncu1', 'Oyuncu2']);
    expect(spool.hasPending()).toBe(true);

    // Bağlantı geri geldi: gönderilmemiş 3 event kaldığı yerden gitmeli,
    // gönderilenler TEKRAR gitmemeli.
    const secondTry: string[] = [];
    const done2 = await spool.drain((e) => {
      secondTry.push((e as Extract<AgentEvent, { type: 'PLAYER_CONNECTED' }>).name);
      return true;
    });

    expect(done2).toBe(true);
    expect(secondTry).toEqual(['Oyuncu3', 'Oyuncu4', 'Oyuncu5']);
    expect(spool.hasPending()).toBe(false);
  });

  it('boşaltma sırasında yazılan yeni eventler de aynı turda gönderilir', async () => {
    const spool = createSpool({ dir });
    await spool.append(event(1));
    await spool.append(event(2));

    const sent: string[] = [];
    let injected = false;
    const done = await spool.drain((e) => {
      sent.push((e as Extract<AgentEvent, { type: 'PLAYER_CONNECTED' }>).name);
      if (!injected) {
        injected = true;
        // Boşaltma sürerken üretilen event — sıranın SONUNA eklenmeli.
        // Senkron yazıyoruz ki test yarışa bağlı olmasın; üretimde bu yazım
        // asenkron ve boşaltma turunu kaçırabilir, o yüzden uplink drain
        // bitince spool'u tekrar kontrol edip gerekirse yeniden boşaltır.
        appendFileSync(path.join(dir, 'spool.ndjson'), `${JSON.stringify(event(9))}\n`);
      }
      return true;
    });

    expect(done).toBe(true);
    expect(sent).toEqual(['Oyuncu1', 'Oyuncu2', 'Oyuncu9']);
    expect(spool.hasPending()).toBe(false);
  });

  it('üst sınır aşılınca yeni eventleri düşürür, mevcutları korur', async () => {
    // Bir event ~150 bayt; 400 baytlık sınır 2-3 event sonra dolar.
    const spool = createSpool({ dir, maxBytes: 400 });
    for (let i = 1; i <= 50; i++) await spool.append(event(i));

    const sent: number[] = [];
    await spool.drain((e) => {
      sent.push(Number((e as Extract<AgentEvent, { type: 'PLAYER_CONNECTED' }>).name.slice(6)));
      return true;
    });

    expect(sent.length).toBeGreaterThan(0);
    expect(sent.length).toBeLessThan(50);
    // Kesintinin BAŞI korunmalı: session açılışları sondaki gürültüden değerli.
    expect(sent[0]).toBe(1);
    expect(sent).toEqual([...sent].sort((a, b) => a - b));
  });

  it('çökmede yarım kalmış satırı atlar, sağlam olanları gönderir', async () => {
    const spool = createSpool({ dir });
    await spool.append(event(1));
    // Süreç tam yazarken ölmüş: son satır yarım.
    await writeFile(path.join(dir, 'spool.ndjson'), `${JSON.stringify(event(1))}\n{"type":"PLAY`);

    const sent: string[] = [];
    const done = await spool.drain((e) => {
      sent.push((e as Extract<AgentEvent, { type: 'PLAYER_CONNECTED' }>).name);
      return true;
    });

    expect(done).toBe(true);
    expect(sent).toEqual(['Oyuncu1']);
  });

  it('önceki çalıştırmadan kalan draining dosyasını da gönderir', async () => {
    // Süreç boşaltmanın ortasında ölmüş: draining dosyası diskte kalmış.
    await writeFile(
      path.join(dir, 'spool.draining.ndjson'),
      `${JSON.stringify(event(1))}\n${JSON.stringify(event(2))}\n`,
    );
    await writeFile(path.join(dir, 'spool.ndjson'), `${JSON.stringify(event(3))}\n`);

    const spool = createSpool({ dir });
    expect(spool.hasPending()).toBe(true);

    const sent: string[] = [];
    const done = await spool.drain((e) => {
      sent.push((e as Extract<AgentEvent, { type: 'PLAYER_CONNECTED' }>).name);
      return true;
    });

    expect(done).toBe(true);
    // Eski (draining) dosya önce, sonra yenisi — sıra korunur.
    expect(sent).toEqual(['Oyuncu1', 'Oyuncu2', 'Oyuncu3']);
    expect(existsSync(path.join(dir, 'spool.draining.ndjson'))).toBe(false);
  });

  it('append disk üzerinde NDJSON üretir (ETL/teşhis okuyabilsin)', async () => {
    const spool = createSpool({ dir });
    await spool.append(event(1));
    const content = await readFile(path.join(dir, 'spool.ndjson'), 'utf8');
    expect(content.endsWith('\n')).toBe(true);
    expect(JSON.parse(content.trim())).toMatchObject({ type: 'PLAYER_CONNECTED', name: 'Oyuncu1' });
  });
});
