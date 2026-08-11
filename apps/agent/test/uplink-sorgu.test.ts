import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, type WebSocket as WsSocket } from 'ws';
import type { createSpool } from '../src/spool.js';
import { type Uplink, createUplink } from '../src/uplink.js';

/**
 * agent -> api sorgu kanalı.
 *
 * Plugin'lerin veritabanı erişimi yok; "bu oyuncunun etiketi var mı"
 * sorusunun tek yolu bu kanal. Buradaki testlerin tamamı BAŞARISIZLIK
 * yollarını kilitliyor, çünkü sorgunun çalıştığı durum zaten görünür:
 * asıl tehlike cevabın hiç gelmemesi ve plugin'in sonsuza kadar beklemesi.
 * Öyle bir plugin bir daha hiçbir olayı işleyemez.
 *
 * Gerçek WebSocket kullanılıyor (sahte değil): zaman aşımı, kopma ve
 * correlationId eşleşmesi taşıma katmanının davranışları.
 */

/** Diske yazmayan spool — bu testler sorgu yolunu ölçüyor, event yolunu değil. */
function bosSpool(): ReturnType<typeof createSpool> {
  return {
    append: async () => undefined,
    drain: async () => true,
    hasPending: () => false,
    size: () => 0,
  };
}

interface Ortam {
  uplink: Uplink;
  /** Sunucuya ULAŞAN sorgu istekleri. */
  gelenler: { correlationId: string; query: { kind: string } }[];
  kapat(): Promise<void>;
  /** Sunucu tarafındaki soketi zorla kapatır (bağlantı kopması). */
  soketiDusur(): void;
}

/**
 * `cevapla`: sunucunun bir sorguya nasıl karşılık vereceği. `undefined`
 * döndürmek "hiç cevaplama" demek — zaman aşımını test etmenin yolu.
 */
async function ortamKur(
  cevapla: (query: { kind: string }) => { ok: boolean; data?: unknown } | undefined,
): Promise<Ortam> {
  const gelenler: Ortam['gelenler'] = [];
  const wss = new WebSocketServer({ port: 0 });
  let soket: WsSocket | undefined;

  wss.on('connection', (ws) => {
    soket = ws;
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'hello') {
        ws.send(
          JSON.stringify({ type: 'hello_ack', serverId: '00000000-0000-4000-8000-000000000001' }),
        );
        return;
      }
      if (msg.type === 'query') {
        gelenler.push(msg.request);
        const cevap = cevapla(msg.request.query);
        if (!cevap) return;
        ws.send(
          JSON.stringify({
            type: 'query_result',
            result: { correlationId: msg.request.correlationId, ...cevap },
          }),
        );
      }
    });
  });

  await new Promise<void>((r) => wss.on('listening', () => r()));
  const port = (wss.address() as AddressInfo).port;

  const uplink = createUplink({
    url: `ws://127.0.0.1:${port}`,
    serverSlug: 'squad-01',
    secret: 'test',
    spool: bosSpool(),
    onCommand: () => undefined,
  });

  // hello_ack gelene kadar sorgu gönderilmiyor; el sıkışmayı bekle.
  await new Promise<void>((r) => setTimeout(r, 150));

  return {
    uplink,
    gelenler,
    soketiDusur: () => soket?.terminate(),
    kapat: async () => {
      await uplink.shutdown();
      await new Promise<void>((r) => wss.close(() => r()));
    },
  };
}

let ortam: Ortam | undefined;

beforeEach(() => {
  ortam = undefined;
});

afterEach(async () => {
  await ortam?.kapat();
});

describe('uplink.sorgu', () => {
  it('cevabın data alanını döndürür', async () => {
    ortam = await ortamKur(() => ({ ok: true, data: { bulundu: true, flags: ['SL BAN'] } }));

    const sonuc = await ortam.uplink.sorgu({ kind: 'player_flags', steamId: '76561190000000001' });

    expect(sonuc).toEqual({ bulundu: true, flags: ['SL BAN'] });
    expect(ortam.gelenler).toHaveLength(1);
    expect(ortam.gelenler[0]?.query).toEqual({
      kind: 'player_flags',
      steamId: '76561190000000001',
    });
  });

  it('api hata döndürürse null verir, THROW ETMEZ', async () => {
    // Sorgu bir plugin'in olay işleyicisinin ortasında çağrılıyor; throw
    // etmesi o olayın işlenmesini yarıda keserdi.
    ortam = await ortamKur(() => ({ ok: false }));

    const sonuc = await ortam.uplink.sorgu({ kind: 'player_flags', steamId: '76561190000000001' });

    expect(sonuc).toBeNull();
  });

  it('bağlantı AÇIKKEN cevap gelmezse zaman aşımıyla null döner', async () => {
    // En sinsi durum bu: soket sağlam, api cevap vermiyor. Kopma sinyali
    // gelmediği için sözü çözecek başka hiçbir şey yok — zaman aşımı
    // olmasa plugin sonsuza kadar beklerdi.
    //
    // Zamanlayıcılar bağlantı KURULDUKTAN sonra sahteleniyor: el sıkışma
    // gerçek zamanla tamamlansın, sonra 10 sn'yi beklemeden ilerletelim.
    ortam = await ortamKur(() => undefined);
    vi.useFakeTimers();
    try {
      const soz = ortam.uplink.sorgu({ kind: 'player_flags', steamId: '76561190000000001' });
      await vi.advanceTimersByTimeAsync(9_000);
      let cozuldu = false;
      void soz.then(() => {
        cozuldu = true;
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(cozuldu).toBe(false);

      await vi.advanceTimersByTimeAsync(1_500);
      await expect(soz).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('bağlantı koparsa bekleyen sorgu HEMEN null olur', async () => {
    // Zaman aşımını beklemenin anlamı yok: cevap verecek taraf gitti.
    ortam = await ortamKur(() => undefined);

    const baslangic = Date.now();
    const soz = ortam.uplink.sorgu({ kind: 'player_playtime', eosId: 'a'.repeat(32) });
    await new Promise<void>((r) => setTimeout(r, 50));
    ortam.soketiDusur();

    expect(await soz).toBeNull();
    expect(Date.now() - baslangic).toBeLessThan(5_000);
  });

  it('correlationId eşleşmeyen cevap bekleyen sorguyu çözmez', async () => {
    // İki sorgu aynı anda açıkken cevapların karışması, bir oyuncunun
    // etiketini başkasına uygulamak demek olurdu.
    ortam = await ortamKur((q) =>
      q.kind === 'player_flags' ? { ok: true, data: { bulundu: true, flags: [] } } : undefined,
    );

    const [flags, playtime] = await Promise.all([
      ortam.uplink.sorgu({ kind: 'player_flags', steamId: '76561190000000001' }),
      (async () => {
        const soz = ortam?.uplink.sorgu({ kind: 'player_playtime', steamId: '76561190000000002' });
        await new Promise<void>((r) => setTimeout(r, 100));
        ortam?.soketiDusur();
        return soz;
      })(),
    ]);

    expect(flags).toEqual({ bulundu: true, flags: [] });
    expect(playtime).toBeNull();
  });
});

describe('uplink.sorgu — bağlantı yokken', () => {
  it('el sıkışma tamamlanmadan sorulursa null döner', async () => {
    // Ulaşılamayan bir adrese bağlanan uplink hiçbir zaman ack almaz.
    const uplink = createUplink({
      // 1 numaralı port ayrıcalıklı ve dinlenmiyor: bağlantı kurulamaz.
      url: 'ws://127.0.0.1:1',
      serverSlug: 'squad-01',
      secret: 'test',
      spool: bosSpool(),
      onCommand: () => undefined,
    });

    await expect(uplink.sorgu({ kind: 'player_flags', steamId: '1' })).resolves.toBeNull();
    await uplink.shutdown();
  });
});
