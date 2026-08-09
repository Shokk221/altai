/**
 * Derleme sonrası CSS kontrolü.
 *
 * Neden var: postcss.config yokken Next hiç hata vermeden globals.css'i ham
 * hâliyle çıktıya kopyalıyordu. `@tailwind` ve `@apply` direktifleri düz
 * metin olarak sunuluyor, panel tamamen stilsiz görünüyordu — ve HTTP 200
 * döndüğü için uzaktan bakınca her şey yolunda sanılıyordu. Sessiz hata,
 * gürültülü hatadan çok daha pahalıya patladı.
 *
 * Bu kontrol iki şeye bakar: CSS makul boyutta mı, ve içinde işlenmemiş
 * direktif kaldı mı.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIZIN = join(process.cwd(), '.next', 'static', 'css');
// Tailwind'in yalnızca preflight'ı bile 8 KB'ın üzerinde. Bunun altı,
// derlemenin çalışmadığı anlamına gelir.
const ASGARI_BAYT = 8_000;

function hata(mesaj) {
  console.error(`\n  CSS KONTROLÜ BAŞARISIZ: ${mesaj}\n`);
  process.exit(1);
}

let dosyalar;
try {
  dosyalar = readdirSync(DIZIN).filter((f) => f.endsWith('.css'));
} catch {
  hata(`${DIZIN} okunamadı — derleme CSS üretmemiş`);
}

if (dosyalar.length === 0) hata('hiç CSS dosyası üretilmemiş');

let toplam = 0;
for (const dosya of dosyalar) {
  const icerik = readFileSync(join(DIZIN, dosya), 'utf8');
  toplam += icerik.length;
  if (icerik.includes('@tailwind') || icerik.includes('@apply')) {
    hata(
      `${dosya} içinde işlenmemiş direktif var — postcss.config.mjs eksik ya da bozuk. ` +
        'Tailwind çalışmamış, arayüz stilsiz görünecek.',
    );
  }
}

if (toplam < ASGARI_BAYT) {
  hata(`CSS toplamı ${toplam} bayt, beklenen en az ${ASGARI_BAYT} — Tailwind çıktısı üretilmemiş`);
}

console.log(`  css kontrolü: ${dosyalar.length} dosya, ${toplam.toLocaleString('tr-TR')} bayt`);
