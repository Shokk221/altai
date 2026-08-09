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
        primary: { DEFAULT: color('primary'), fg: color('primary-fg') },
        danger: { DEFAULT: color('danger'), fg: color('danger-fg') },
        warning: { DEFAULT: color('warning'), fg: color('warning-fg') },
        success: color('success'),
        info: color('info'),
        ring: color('ring'),
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        lg: 'calc(var(--radius) + 2px)',
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
