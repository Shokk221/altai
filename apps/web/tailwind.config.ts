import type { Config } from 'tailwindcss';

/**
 * Tasarım sistemi — Apple dili.
 *
 * Renkler globals.css'teki değişkenlerden okunuyor; burada yalnızca isim
 * veriliyor. Böylece tema tek yerden değişiyor ve `bg-surface`,
 * `text-fg-muted` gibi anlamsal sınıflar kullanılabiliyor — `bg-zinc-900`
 * gibi ham renkler kod tabanına dağılmıyor.
 *
 * Değerler hex olduğu için `<alpha-value>` yerine `color-mix` gerekirdi;
 * onun yerine saydamlığa ihtiyaç duyulan iki renk (accent-weak, accent-ring)
 * ayrı belirteç olarak tanımlı.
 */
const v = (name: string) => `var(--${name})`;

export default {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  // Koyu tek yön: bu dil saf siyah üzerine kurulu, açık teması yok.
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        'surface-2': v('surface-2'),
        'surface-sunken': v('surface-sunken'),
        border: v('border'),
        'border-strong': v('border-strong'),
        fg: v('fg'),
        'fg-muted': v('fg-muted'),
        'fg-faint': v('fg-faint'),
        ink: { DEFAULT: v('ink'), fg: v('ink-fg') },
        accent: {
          DEFAULT: v('accent'),
          2: v('accent-2'),
          fg: v('accent-fg'),
          weak: v('accent-weak'),
        },
        danger: { DEFAULT: v('danger'), fg: v('danger-fg') },
        success: v('success'),
        warn: v('warn'),
        info: v('info'),
        team1: v('team1'),
        team2: v('team2'),
        ring: v('accent-ring'),
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        lg: 'calc(var(--radius) + 0.25rem)',
        sm: 'calc(var(--radius) - 0.375rem)',
      },
      boxShadow: {
        // Saf siyah zeminde gölge ancak yükseltilmiş yüzeyde okunuyor;
        // kartların ayrımını kenarlık yapıyor.
        card: '0 1px 3px rgba(0, 0, 0, .4)',
        lift: '0 4px 24px rgba(0, 0, 0, .4), 0 30px 70px rgba(0, 0, 0, .55)',
      },
      fontFamily: {
        // Apple'ın kendi sitelerinin yaptığı: sistem yığını. SF Pro webfont
        // olarak dağıtılamıyor (lisans); macOS ve iOS'ta -apple-system
        // gerçek SF Pro'ya, Windows'ta Segoe UI'ya düşüyor.
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'SF Pro Display',
          'SF Pro Text',
          'Helvetica Neue',
          'Segoe UI',
          'system-ui',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SF Mono', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
      },
      animation: { 'fade-in': 'fade-in 120ms ease-out' },
    },
  },
  plugins: [],
} satisfies Config;
