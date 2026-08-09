import type { Config } from 'tailwindcss';

/**
 * Tasarım sistemi — plan Bölüm 8 ("UI birinci sınıf öncelik").
 *
 * Renkler globals.css'teki CSS değişkenlerinden okunuyor; burada sadece
 * Tailwind'e isim veriliyor. Böylece tema tek yerden değişiyor ve
 * `bg-surface`, `text-fg-muted` gibi anlamsal sınıflar kullanılabiliyor —
 * `bg-gray-800` gibi ham renkler kod tabanına dağılmıyor.
 */
const color = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  // Koyu tema yok: yön sıcak açık-orta zemin. Tek koyu eleman (ink) zaten
  // paletin içinde.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: color('bg'),
        surface: color('surface'),
        'surface-2': color('surface-2'),
        border: color('border'),
        fg: color('fg'),
        'fg-muted': color('fg-muted'),
        ink: { DEFAULT: color('ink'), fg: color('ink-fg') },
        accent: { DEFAULT: color('accent'), fg: color('accent-fg') },
        danger: { DEFAULT: color('danger'), fg: color('danger-fg') },
        success: color('success'),
        info: color('info'),
        ring: color('ring'),
      },
      borderRadius: {
        // Cömert yuvarlaklık bu dilin belirleyici özelliği; kartlar yumuşak,
        // küçük öğeler tam hap.
        DEFAULT: 'var(--radius)',
        lg: 'calc(var(--radius) + 0.25rem)',
        sm: 'calc(var(--radius) - 0.5rem)',
      },
      boxShadow: {
        // Ayrım çizgiyle değil, çok yumuşak bir gölgeyle yapılıyor.
        // Sert kenarlıklar bu kompozisyonu ağırlaştırıyor.
        card: '0 1px 2px hsl(40 10% 20% / 0.04), 0 8px 24px -12px hsl(40 10% 20% / 0.10)',
      },
      fontFamily: {
        // Sistem yazı tipi yığını: dış bağımlılık yok, ilk boyama hızlı.
        sans: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: { 'fade-in': 'fade-in 120ms ease-out' },
    },
  },
  plugins: [],
} satisfies Config;
