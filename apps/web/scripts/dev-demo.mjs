/**
 * Paneli ÖRNEK VERİYLE açar — api, Postgres ve Discord olmadan.
 *
 * Neden ayrı bir betik: `ALTAI_DEMO=1 next dev` yazımı Windows'ta cmd ve
 * PowerShell'de çalışmıyor. Burada değişken Node tarafında veriliyor,
 * üç işletim sisteminde de aynı.
 *
 * `next` ikilisi PATH'ten DEĞİL node_modules'tan çözülüyor: betik
 * doğrudan `node scripts/dev-demo.mjs` ile de çağrılabilsin diye
 * (pnpm üzerinden çağrıldığında PATH zaten hazır, ama tek yol o değil).
 *
 * Demo kipi üretimde açılamaz; kontrol src/lib/api.ts içinde ve
 * NODE_ENV'e bağlı.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const kok = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = process.argv[2] ?? '3000';

/** next'in çalıştırılabilir JS girişini bulur. */
function nextGirisi() {
  const require = createRequire(join(kok, 'package.json'));
  try {
    // next/dist/bin/next doğrudan çalıştırılabilir bir JS dosyası.
    return require.resolve('next/dist/bin/next');
  } catch {
    // Monorepo'da paket kökte duruyor olabilir.
    const aday = join(kok, '..', '..', 'node_modules', 'next', 'dist', 'bin', 'next');
    return existsSync(aday) ? aday : null;
  }
}

const giris = nextGirisi();
if (!giris) {
  console.error('\n  next bulunamadı. Önce bağımlılıkları kurun: pnpm install\n');
  process.exit(1);
}

console.log(`\n  Altai paneli demo kipinde açılıyor — http://localhost:${port}`);
console.log('  Örnek veri: src/fixtures/ornek.ts · giriş gerekmiyor\n');

const cocuk = spawn(process.execPath, [giris, 'dev', '--port', port], {
  cwd: kok,
  stdio: 'inherit',
  env: {
    ...process.env,
    ALTAI_DEMO: '1',
    // Tarayıcı isteklerinin gideceği kök (bkz. publicApiUrl).
    ALTAI_DEMO_ORIGIN: `http://localhost:${port}`,
  },
});

cocuk.on('exit', (kod) => process.exit(kod ?? 0));
