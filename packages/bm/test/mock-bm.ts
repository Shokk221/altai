import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * Canlı ayna için sahte BM. Arşiv aracının mock'undan ayrı, çünkü o
 * sayfalama/resume/429 davranışını sınıyor; burada sınanan şey tek
 * oyuncunun JSON:API cevabının doğru çözülmesi.
 */

export interface MockOptions {
  /** Bu yol parçalarını içeren istekler 403 döner. */
  forbidden?: string[];
  /**
   * Arama cevabına, aradığımız kimliğe sahip OLMAYAN bir oyuncu koy —
   * isminde o rakamlar geçen başkası. Yanlış eşleşme testi için.
   */
  searchReturnsImposter?: boolean;
}

export interface MockServer {
  url: string;
  requests: string[];
  close(): Promise<void>;
}

const STEAM = '76561198000000001';
export const MOCK_STEAM_ID = STEAM;
export const MOCK_BM_PLAYER_ID = '4242';

export async function startMockBm(options: MockOptions = {}): Promise<MockServer> {
  const requests: string[] = [];
  const forbidden = options.forbidden ?? [];

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;
    requests.push(p + url.search);

    const gonder = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (forbidden.some((f) => (p + url.search).includes(f))) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ errors: [{ status: '403' }] }));
      return;
    }

    // --- Oyuncu arama ---
    if (p === '/players') {
      if (options.searchReturnsImposter) {
        // BM'nin `filter[search]` filtresi isme de bakıyor: adında
        // aradığımız rakamlar geçen BAŞKA bir oyuncu dönüyor ve onun
        // kimlikleri bizimkiyle eşleşmiyor.
        gonder({
          data: [{ type: 'player', id: '9999', attributes: { name: `fake${STEAM}` } }],
          included: [
            {
              type: 'identifier',
              id: 'i-9999',
              attributes: { type: 'steamID', identifier: '76561198999999999' },
              relationships: { player: { data: { type: 'player', id: '9999' } } },
            },
          ],
        });
        return;
      }
      gonder({
        data: [{ type: 'player', id: MOCK_BM_PLAYER_ID, attributes: { name: 'Hedef' } }],
        included: [
          {
            type: 'identifier',
            id: 'i-1',
            attributes: { type: 'steamID', identifier: STEAM },
            relationships: { player: { data: { type: 'player', id: MOCK_BM_PLAYER_ID } } },
          },
        ],
      });
      return;
    }

    // --- Notlar ---
    if (p === `/players/${MOCK_BM_PLAYER_ID}/relationships/notes`) {
      gonder({
        data: [
          {
            type: 'playerNote',
            id: 'n-1',
            attributes: {
              note: 'Tek kullanımlık hesap şüphesi',
              createdAt: '2024-03-01T10:00:00.000Z',
              updatedAt: '2024-03-02T10:00:00.000Z',
            },
            relationships: { user: { data: { type: 'user', id: 'u-1' } } },
          },
          // Gövdesi boş not: taşınmaması gerekiyor.
          { type: 'playerNote', id: 'n-2', attributes: { note: '   ' } },
        ],
        included: [{ type: 'user', id: 'u-1', attributes: { nickname: 'ModeratorAli' } }],
      });
      return;
    }

    // --- Banlar ---
    if (p === '/bans') {
      gonder({
        data: [
          {
            type: 'ban',
            id: 'b-1',
            attributes: {
              reason: 'Takım öldürme',
              note: 'üçüncü kez',
              expires: null,
              timestamp: '2025-01-05T08:00:00.000Z',
            },
            relationships: {
              user: { data: { type: 'user', id: 'u-2' } },
              banList: { data: { type: 'banList', id: 'bl-1' } },
            },
          },
        ],
        included: [
          { type: 'user', id: 'u-2', attributes: { nickname: 'AdminVeli' } },
          { type: 'banList', id: 'bl-1', attributes: { name: 'Altai Ana Liste' } },
        ],
      });
      return;
    }

    // --- Tek oyuncu: isimler + sunucu süreleri ---
    if (p === `/players/${MOCK_BM_PLAYER_ID}`) {
      gonder({
        data: {
          type: 'player',
          id: MOCK_BM_PLAYER_ID,
          attributes: { name: 'YeniIsim' },
          relationships: {
            servers: {
              // Yalnızca ikinci sunucunun süresi BURADA; birincisininki
              // included kaydının meta'sında. İki yolun ikisi de sınanıyor.
              data: [
                {
                  type: 'server',
                  id: '28022344',
                  meta: {
                    timePlayed: 7_200,
                    firstSeen: '2025-02-01T00:00:00.000Z',
                    lastSeen: '2025-03-01T00:00:00.000Z',
                  },
                },
              ],
            },
          },
        },
        included: [
          // Aynı isim iki kayıtta: birleşmesi gerekiyor.
          {
            type: 'identifier',
            id: 'i-n1',
            attributes: {
              type: 'name',
              identifier: 'EskiIsim',
              firstSeen: '2023-01-01T00:00:00.000Z',
              lastSeen: '2023-06-01T00:00:00.000Z',
            },
          },
          {
            type: 'identifier',
            id: 'i-n2',
            attributes: {
              type: 'name',
              identifier: 'EskiIsim',
              firstSeen: '2022-05-01T00:00:00.000Z',
              lastSeen: '2023-02-01T00:00:00.000Z',
            },
          },
          {
            type: 'identifier',
            id: 'i-n3',
            attributes: {
              type: 'name',
              identifier: 'YeniIsim',
              firstSeen: '2024-01-01T00:00:00.000Z',
              lastSeen: '2026-01-01T00:00:00.000Z',
            },
          },
          { type: 'identifier', id: 'i-s', attributes: { type: 'steamID', identifier: STEAM } },
          {
            type: 'server',
            id: '27133078',
            attributes: { name: 'Altai #1' },
            meta: {
              timePlayed: 360_000,
              firstSeen: '2022-05-01T00:00:00.000Z',
              lastSeen: '2026-01-01T00:00:00.000Z',
            },
          },
          // Süre meta'sı included'da YOK — oyuncunun ilişkisinden okunmalı.
          { type: 'server', id: '28022344', attributes: { name: 'Altai #2' } },
        ],
      });
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ errors: [{ status: '404' }] }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
