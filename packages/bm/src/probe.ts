import { type BmClient, BmHttpError } from './client.js';
import { bmOyuncuAynasi, bmOyuncuBul } from './player.js';

/**
 * Canlı aynanın BM uçlarını gerçek token'la yoklar.
 *
 * NEDEN AYRI BİR ARAÇ: ayna üç varsayım üzerine kurulu ve üçü de bu
 * ortamda doğrulanamadı (token yok). Varsayımlar yanlışsa ayna çökmüyor —
 * ilgili kaynağı "erişilemeyen" işaretleyip devam ediyor — ama bu da
 * sessiz bir eksiklik demek: notlar hiç gelmezken panel çalışmaya devam
 * eder. Yoklama o sessizliği bozuyor.
 *
 * Arşivin `--probe`'undan farkı: o org geneli listeleme uçlarını yokluyor,
 * bu ise TEK OYUNCU yolunu — aynanın gerçekten kullandığı yolu.
 *
 * Hiçbir şey yazmaz, 6 istekten fazla atmaz.
 */

export interface YoklamaSonucu {
  ad: string;
  durum: 'ok' | 'yok' | 'hata';
  /** Ne görüldüğü ve yanlışsa ne yapılacağı. */
  detay: string;
  /**
   * Kritik olan, aynanın VAR OLMA SEBEBİ olan şey. Eski isimler ve notlar
   * kritik; BM banı ve oynama süresi yalnızca gösterim, onlar olmadan da
   * ayna işini yapıyor.
   */
  kritik: boolean;
}

export interface YoklamaOptions {
  /**
   * Yoklanacak oyuncunun SteamID'si. Sunucunuzda oynadığını bildiğiniz
   * biri olmalı: BM'de hiç kaydı olmayan bir kimlikle yoklamak, çalışan
   * bir ucu "bulunamadı" diye raporlar.
   */
  steamId: string;
  serverIds?: string[];
}

function hataDetayi(err: unknown): string {
  if (err instanceof BmHttpError) {
    if (err.status === 401) return 'HTTP 401 — token geçersiz ya da süresi dolmuş';
    if (err.status === 403) return 'HTTP 403 — token bu kaynağa yetkili değil (abonelik planı?)';
    if (err.status === 400) return 'HTTP 400 — BM bu filtreyi kabul etmiyor, sorgu düzeltilmeli';
    return `HTTP ${err.status}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export async function aynayiYokla(
  client: BmClient,
  opts: YoklamaOptions,
): Promise<YoklamaSonucu[]> {
  const sonuclar: YoklamaSonucu[] = [];

  // 1) Token hiç çalışıyor mu. Bu başarısızsa gerisini denemek anlamsız:
  //    hepsi aynı 401'i tekrarlar ve çıktı asıl sebebi gizler.
  const params: Record<string, string> = { 'page[size]': '1' };
  if (opts.serverIds?.length) params['filter[servers]'] = opts.serverIds.join(',');
  try {
    await client.get('/players', params);
    sonuclar.push({
      ad: 'token',
      durum: 'ok',
      detay: '/players yanıt verdi',
      kritik: true,
    });
  } catch (err) {
    sonuclar.push({ ad: 'token', durum: 'hata', detay: hataDetayi(err), kritik: true });
    return sonuclar;
  }

  // 2) Kimlik araması — aynanın en kırılgan yeri. BM'nin `filter[search]`
  //    filtresinin SteamID kabul ettiği varsayımı burada sınanıyor.
  let bmPlayerId: string | null = null;
  try {
    bmPlayerId = await bmOyuncuBul(
      client,
      { steamId: opts.steamId },
      opts.serverIds?.length ? { serverIds: opts.serverIds } : {},
    );
    sonuclar.push({
      ad: 'kimlik-aramasi',
      durum: bmPlayerId ? 'ok' : 'yok',
      detay: bmPlayerId
        ? `SteamID -> BM oyuncu ${bmPlayerId}`
        : 'eşleşme yok. Bu SteamID gerçekten sunucunuzda oynadıysa ' +
          'filter[search] SteamID kabul etmiyor demektir — bmOyuncuBul düzeltilmeli',
      kritik: true,
    });
  } catch (err) {
    sonuclar.push({
      ad: 'kimlik-aramasi',
      durum: 'hata',
      detay: hataDetayi(err),
      kritik: true,
    });
  }

  if (!bmPlayerId) {
    // Oyuncu çözülmediyse alt kaynakları yoklayamayız; uydurma bir id ile
    // denemek 404 döner ve "uç kapalı" gibi görünür — yanlış teşhis.
    sonuclar.push({
      ad: 'isimler / notlar / banlar / süre',
      durum: 'yok',
      detay: 'oyuncu çözülemediği için yoklanamadı',
      kritik: true,
    });
    return sonuclar;
  }

  // 3) Tek oyuncu ayrıntısı: isimler, süreler, notlar, banlar.
  try {
    const veri = await bmOyuncuAynasi(client, bmPlayerId);

    sonuclar.push({
      ad: 'eski isimler',
      durum: veri.isimler.length > 0 ? 'ok' : 'yok',
      detay:
        veri.isimler.length > 0
          ? `${veri.isimler.length} isim (en güncel: ${veri.isimler[0]?.name})`
          : 'identifier kaydı gelmedi — include=identifier çalışmıyor olabilir',
      kritik: true,
    });

    const notlarKapali = veri.erisilemeyen.includes('notlar');
    sonuclar.push({
      ad: 'notlar',
      durum: notlarKapali ? 'hata' : 'ok',
      detay: notlarKapali
        ? 'uç erişime kapalı — notlar Premium/RCON aboneliği ister'
        : `${veri.notlar.length} not okundu`,
      kritik: true,
    });

    const banlarKapali = veri.erisilemeyen.includes('banlar');
    sonuclar.push({
      ad: 'banlar (gösterim)',
      durum: banlarKapali ? 'yok' : 'ok',
      detay: banlarKapali
        ? '/bans?filter[player] kabul edilmedi — BM ban bölümü boş kalır, ayna çalışmaya devam eder'
        : `${veri.banlar.length} ban okundu`,
      kritik: false,
    });

    const sureliSunucu = veri.sunucular.filter((s) => s.timePlayed !== null).length;
    sonuclar.push({
      ad: 'oynama süresi (gösterim)',
      durum: sureliSunucu > 0 ? 'ok' : 'yok',
      detay:
        sureliSunucu > 0
          ? `${sureliSunucu}/${veri.sunucular.length} sunucuda süre bulundu`
          : `${veri.sunucular.length} sunucu geldi ama hiçbirinde süre meta'sı yok — BM bu bilgiyi başka bir alanda veriyor olabilir`,
      kritik: false,
    });
  } catch (err) {
    sonuclar.push({
      ad: 'oyuncu ayrıntısı',
      durum: 'hata',
      detay: hataDetayi(err),
      kritik: true,
    });
  }

  return sonuclar;
}

/** Yoklama sonucunu okunur bir rapora çevirir. */
export function yoklamaRaporu(sonuclar: YoklamaSonucu[]): string[] {
  const isaret = { ok: '✓', yok: '·', hata: '✗' } as const;
  const satirlar: string[] = ['', 'BM canlı aynası — uç yoklaması', ''];

  for (const s of sonuclar) {
    const etiket = s.kritik ? 'kritik' : 'gösterim';
    satirlar.push(`  ${isaret[s.durum]} ${s.ad.padEnd(26)} [${etiket}]  ${s.detay}`);
  }

  const kritikSorun = sonuclar.filter((s) => s.kritik && s.durum !== 'ok');
  satirlar.push('');
  if (kritikSorun.length === 0) {
    satirlar.push('  ✓ Kritik uçların hepsi çalışıyor — ayna tam kapasite okuyor.');
  } else {
    satirlar.push(
      `  ✗ ${kritikSorun.length} kritik uç sorunlu: ${kritikSorun.map((s) => s.ad).join(', ')}`,
    );
    satirlar.push('    Ayna çalışmaya devam eder ama bu veriler panelde hiç görünmez.');
  }
  satirlar.push('');
  return satirlar;
}
