import type { Kural } from '@/components/kurallar';

/**
 * Kural kodu ve özeti.
 *
 * KOD SİTEDEN GELİYOR. Kurallar `title` alanında kendi koduyla duruyor
 * (GEN-1, SL-12, ARAÇ-7); altaisquad.com/kurallar sayfasındaki rozetin
 * aynısı. Önce kod sıra numarasından türetiliyordu (`K-3`) ama bu iki
 * şeyi bozuyordu: kurallar yeniden sıralandığında kod değişiyordu ve
 * oyuncuların yıllardır kullandığı kodlarla uyuşmuyordu.
 *
 * `@altai/db` içindeki `kuralOzeti` ile aynı işi yapıyor ama kasten
 * KOPYA: apps/web çalışma anında paket içi bağımlılık alamıyor
 * (bkz. web'de contracts importu yasağı) ve bu altı satır için bir
 * paket sınırı aşmaya değmez.
 */

export function kuralKodu(kural: Kural): string {
  return kural.title.trim();
}

/**
 * Kuralın kısa karşılığı — ban mesajında kodun yanında duran açıklama.
 *
 * Sitedeki kuralların ayrı bir başlığı yok, yalnızca kod ve gövde var.
 * Ban mesajı oyuncunun gördüğü TEK şey ve oraya 700 karakterlik bir
 * madde listesi sığmıyor; gövdenin ilk satırı kuralın kendisini
 * söylüyor.
 */
export function kuralOzeti(kural: Kural, enFazla = 140): string {
  const ilk = (kural.body.split('\n')[0] ?? '').replace(/^•\s*/, '').trim();
  if (ilk.length <= enFazla) return ilk;
  // Kelime ortasından kesmiyoruz.
  const kesik = ilk.slice(0, enFazla);
  const son = kesik.lastIndexOf(' ');
  return `${(son > 60 ? kesik.slice(0, son) : kesik).trim()}…`;
}

/** Aktif kurallar, bölümlerine göre gruplu ve sitedeki sırayla. */
export function bolumlereAyir(kurallar: Kural[]): { bolum: string; kurallar: Kural[] }[] {
  const gruplar = new Map<string, Kural[]>();
  for (const k of kurallar
    .filter((x) => x.active !== false)
    .sort((a, b) => a.position - b.position)) {
    const ad = k.category?.trim() || 'Diğer';
    const dizi = gruplar.get(ad);
    if (dizi) dizi.push(k);
    else gruplar.set(ad, [k]);
  }
  return [...gruplar].map(([bolum, kurallar]) => ({ bolum, kurallar }));
}

/**
 * Arama: koda ve metne bakıyor.
 *
 * 52 kural var; listeyi gözle taramak yavaş. Yetkili genelde ne
 * aradığını biliyor ("tk", "kamikaze", "SL-12") ve yazarak bulması
 * kaydırmasından hızlı.
 */
export function kuralAra(kurallar: Kural[], sorgu: string): Kural[] {
  const q = sorgu.trim().toLocaleLowerCase('tr');
  if (!q) return kurallar;
  return kurallar.filter(
    (k) =>
      k.title.toLocaleLowerCase('tr').includes(q) ||
      k.body.toLocaleLowerCase('tr').includes(q) ||
      (k.category ?? '').toLocaleLowerCase('tr').includes(q),
  );
}
