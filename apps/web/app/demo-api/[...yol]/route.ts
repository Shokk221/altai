import { demoCevap } from '@/fixtures/demo-api';
import { demoKipi } from '@/lib/api';
import { NextResponse } from 'next/server';

/**
 * Demo kipinin sahte api ucu.
 *
 * NEDEN VAR: panelin bir kısmı veriyi TARAYICIDAN çekiyor (oyuncu
 * araması, sohbet dökümü, birlikte oynadıkları, etiket listesi, günlüğün
 * sonraki sayfaları, klan üyeleri). Sunucu tarafındaki demo verisi
 * bunlara yetmiyor; istek gerçekten ağa çıkıyor ve api yokken
 * "Sunucuya ulaşılamadı" yazıyordu.
 *
 * `ALTAI_DEMO=1` iken `publicApiUrl()` tarayıcıyı buraya yönlendiriyor,
 * burası da sunucudakiyle AYNI örnek veriyi döndürüyor — iki yerde iki
 * farklı sayı çıkmıyor.
 *
 * ÜRETİMDE YOK: demo kipi kapalıyken 404. Bu uç kimlik doğrulaması
 * olmayan bir veri kapısı; açık kalması paneli herkese açardı.
 */

async function cevapla(yol: string[]): Promise<NextResponse> {
  if (!demoKipi()) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const path = `/${yol.join('/')}`;

  // Oturum uçları: demo kipinde hep aynı kullanıcı.
  if (path === '/auth/logout') return NextResponse.json({ ok: true });
  if (path === '/auth/me') {
    return NextResponse.json({
      id: 'u-demo',
      discordUsername: 'yalnizkurt',
      systemRole: 'super_admin',
      permissions: [],
      isBreakGlass: false,
    });
  }

  const veri = demoCevap<unknown>(path);
  if (veri === undefined) return NextResponse.json({ error: 'bulunamadi' }, { status: 404 });
  if (veri === null) return NextResponse.json({ error: 'demo_veri_yok' }, { status: 404 });
  return NextResponse.json(veri);
}

export async function GET(
  istek: Request,
  { params }: { params: Promise<{ yol: string[] }> },
): Promise<NextResponse> {
  const { yol } = await params;
  // Sorgu dizesi de aktarılıyor: sıralama ölçütü gibi süzgeçler
  // sunucudakiyle aynı şekilde çalışsın.
  const sorgu = new URL(istek.url).search;
  const path = `${yol.join('/')}${sorgu}`;
  return cevapla(path.split('/'));
}

/**
 * Yazma istekleri: demo kipinde veri kalıcı değil, ama ekranın
 * "kaydedildi" yolunu izleyebilmek için başarı dönüyoruz. Sayfa
 * `router.refresh()` çağırıyor ve aynı örnek veri yeniden basılıyor.
 */
export async function POST(): Promise<NextResponse> {
  if (!demoKipi()) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json({ ok: true, demo: true });
}

export const PATCH = POST;
export const DELETE = POST;
