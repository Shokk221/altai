import { hashPassword } from '@altai/shared';

// Kullanım: pnpm --filter @altai/hash-password start -- 'şifre-buraya'
// Çıktıyı .env'deki BREAK_GLASS_PASSWORD_HASH alanına yapıştır.
const plain = process.argv[2];
if (!plain) {
  console.error("Kullanım: pnpm --filter @altai/hash-password start -- 'şifre'");
  process.exit(1);
}

const hash = await hashPassword(plain);
console.log(hash);
