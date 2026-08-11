import { hashPassword } from '@altai/shared';

// Kullanım: pnpm hash-password 'şifre-buraya'
// Çıktıyı .env'deki BREAK_GLASS_PASSWORD_HASH alanına yapıştır.

// pnpm/npm, "start -- 'sifre'" çağrısında argümanların ARASINA literal bir
// "--" koyuyor. Bu ayraç filtrelenmezse argv[2] = "--" oluyordu ve araç
// kullanıcının şifresi yerine "--" metnini hash'liyordu — yani dokümandaki
// komutu izleyen herkesin acil süper-admin şifresi iki karakterlik "--"
// olurdu. Sessiz ve tehlikeli bir hataydı.
const args = process.argv.slice(2).filter((a) => a !== '--');
const plain = args[0];

if (!plain) {
  console.error("Kullanım: pnpm hash-password 'şifre'");
  process.exit(1);
}

// Bu şifre Discord'u tamamen atlayan süper admin girişi. Zayıf olamaz.
const MIN_LENGTH = 12;
if (plain.length < MIN_LENGTH) {
  console.error(
    `Şifre en az ${MIN_LENGTH} karakter olmalı (verilen: ${plain.length}).\nBu, Discord kesintisinde tüm yetkilere açılan acil giriş — kısa şifre kabul edilmiyor.`,
  );
  process.exit(1);
}

if (args.length > 1) {
  console.error(
    'Birden fazla argüman verildi. Şifreyi tek tırnak içine alın:\n' +
      "  pnpm hash-password 'benim sifrem'",
  );
  process.exit(1);
}

const hash = await hashPassword(plain);
// Şifrenin kendisini ASLA yazdırmıyoruz; sadece hash ve doğrulama için uzunluk.
console.error(`(${plain.length} karakterlik şifre hash'lendi)`);
console.log(hash);
