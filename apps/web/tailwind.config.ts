import type { Config } from 'tailwindcss';

// Bölüm 8: tasarım sistemi burada büyüyecek — renk paleti, koyu tema
// varsayılan, tipografi/spacing ölçeği. Faz 0'da sadece iskelet.
export default {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: { extend: {} },
  plugins: [],
} satisfies Config;
