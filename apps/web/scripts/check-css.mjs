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
import { readFileSync, readdirSync, statSync } from 'node:fs';
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
      `${dosya} içinde işlenmemiş direktif var — postcss.config.mjs eksik ya da bozuk. Tailwind çalışmamış, arayüz stilsiz görünecek.`,
    );
  }
}

if (toplam < ASGARI_BAYT) {
  hata(`CSS toplamı ${toplam} bayt, beklenen en az ${ASGARI_BAYT} — Tailwind çıktısı üretilmemiş`);
}

/**
 * İkinci kontrol: değişken tabanlı renklerde opaklık eki.
 *
 * Paletimizdeki renkler `var(--accent)` gibi CSS değişkenlerine bağlı ve
 * değerleri hex. Tailwind hex bir değişkene `/15` gibi bir opaklık
 * ekleyemiyor — sınıfı SESSİZCE hiç üretmiyor. Sonuç: `bg-danger/15`
 * yazan rozet renksiz kalıyor, `bg-accent/15` yazan seçili satır
 * seçilmemiş gibi duruyor, `bg-bg/72` yazan üst çubuk tamamen saydam
 * oluyor. Hepsi gerçekten yaşandı ve hiçbiri hata vermedi.
 *
 * Tailwind'in KENDİ renkleri (black, white, zinc...) hex literal olduğu
 * için opaklık orada çalışıyor; bu yüzden liste yalnızca bizim
 * belirteçlerimizi kapsıyor.
 *
 * Saydam bir ton lazımsa globals.css'e ayrı belirteç eklenir
 * (`--accent-weak`, `--warn-line` gibi) ve tailwind.config.ts'e adıyla
 * kaydedilir.
 */
const DEGISKEN_RENKLER = [
  'bg',
  'surface',
  'surface-2',
  'surface-sunken',
  'border',
  'border-strong',
  'fg',
  'fg-muted',
  'fg-faint',
  'ink',
  'accent',
  'accent-2',
  'danger',
  'success',
  'warn',
  'info',
  'team1',
  'team2',
];
/** Opaklık eki alabilen yardımcı sınıf önekleri. */
const ONEKLER = [
  'bg',
  'text',
  'border',
  'ring',
  'fill',
  'stroke',
  'from',
  'via',
  'to',
  'divide',
  'outline',
  'shadow',
];

// Ters bölü çiftleniyor: şablon dizgesi içinde tek `\d` yalnızca `d`
// harfine dönüşüyor ve kalıp hiçbir şeyi yakalamıyor. Bir kez böyle
// yazıldı ve kontrol sessizce hiçbir şey bulmadı — koruma görevi yapmayan
// koruma, hiç olmamasından kötü.
const OPAKLIK = new RegExp(
  `\\b(?:${ONEKLER.join('|')})-(?:${DEGISKEN_RENKLER.join('|')})(?:-[a-z0-9]+)*\\/\\d+`,
  'g',
);

function kaynaklar(dizin) {
  const out = [];
  for (const ad of readdirSync(dizin)) {
    if (ad === 'node_modules' || ad === '.next') continue;
    const tam = join(dizin, ad);
    if (statSync(tam).isDirectory()) out.push(...kaynaklar(tam));
    else if (tam.endsWith('.tsx') || tam.endsWith('.ts')) out.push(tam);
  }
  return out;
}

const bulgular = [];
for (const kok of ['app', 'src']) {
  let dosyalarKaynak;
  try {
    dosyalarKaynak = kaynaklar(join(process.cwd(), kok));
  } catch {
    continue;
  }
  for (const dosya of dosyalarKaynak) {
    const satirlar = readFileSync(dosya, 'utf8').split('\n');
    satirlar.forEach((satir, i) => {
      for (const eslesme of satir.match(OPAKLIK) ?? []) {
        bulgular.push(`${dosya.replace(process.cwd(), '.')}:${i + 1}  ${eslesme}`);
      }
    });
  }
}

if (bulgular.length > 0) {
  hata(
    [
      'değişken tabanlı renge opaklık eki verilmiş — bu sınıflar hiç üretilmez:',
      ...bulgular.map((b) => `    ${b}`),
      '',
      "  Çözüm: globals.css'e saydam belirteç ekleyin (ör. --accent-weak),",
      "  tailwind.config.ts'e adıyla kaydedin ve `bg-accent-weak` gibi kullanın.",
    ].join('\n'),
  );
}

console.log(
  `  css kontrolü: ${dosyalar.length} dosya, ${toplam.toLocaleString('tr-TR')} bayt, opaklık ihlali yok`,
);
