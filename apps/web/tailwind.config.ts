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
        bg: { DEFAULT: v('bg'), blur: v('bg-blur') },
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
          // Kenarlık/halka için: tam renk fazla sert, saydamı ayrı belirteç.
          line: v('accent-ring'),
        },
        danger: { DEFAULT: v('danger'), fg: v('danger-fg'), weak: v('danger-weak') },
        success: { DEFAULT: v('success'), weak: v('success-weak') },
        warn: { DEFAULT: v('warn'), weak: v('warn-weak'), line: v('warn-line') },
        info: { DEFAULT: v('info'), weak: v('info-weak') },
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
      /**
       * Yazı ölçeği — Apple'ın metin stilleri.
       *
       * Önce 17 ayrı boyut vardı (10.5px, 11.5px, 12.5px gibi ara
       * değerlerle); yan yana duran iki etiket yarım piksel farkla
       * dağınık görünüyordu. Artık her boyut Apple'daki bir stile karşılık
       * geliyor ve köşeli parantezli boyut YAZILMIYOR.
       *
       * Harf aralığı boyutla birlikte daralıyor: SF'nin kendi davranışı bu.
       * Küçük yazı gevşek, büyük yazı sıkı; tek bir değer ikisinden birini
       * bozuyordu.
       *
       * 11px TABAN: Apple'ın en küçük metin stili (Caption 2). Altı okunmuyor.
       */
      fontSize: {
        '2xs': ['11px', { lineHeight: '14px', letterSpacing: '0.005em' }], // Caption 2
        xs: ['12px', { lineHeight: '16px', letterSpacing: '-0.005em' }], // Caption 1
        footnote: ['13px', { lineHeight: '18px', letterSpacing: '-0.01em' }], // Footnote
        sm: ['14px', { lineHeight: '20px', letterSpacing: '-0.015em' }], // yoğun gövde
        subhead: ['15px', { lineHeight: '20px', letterSpacing: '-0.016em' }], // Subheadline
        base: ['17px', { lineHeight: '24px', letterSpacing: '-0.022em' }], // Body
        lg: ['18px', { lineHeight: '24px', letterSpacing: '-0.02em' }],
        xl: ['20px', { lineHeight: '25px', letterSpacing: '-0.02em' }], // Title 3
        '2xl': ['24px', { lineHeight: '30px', letterSpacing: '-0.025em' }],
        '3xl': ['28px', { lineHeight: '34px', letterSpacing: '-0.028em' }], // Title 1
        '4xl': ['34px', { lineHeight: '41px', letterSpacing: '-0.03em' }], // Large Title
      },
      /**
       * Hareket — Apple'ın arayüz eğrisi.
       *
       * Varsayılan süre ve eğri BURADA değişiyor: `transition-colors` yazan
       * her öğe bunu alıyor, tek tek düzeltmeye gerek kalmıyor.
       */
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        apple: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
        // Açılan pencere hafifçe yerine oturuyor; yay hissi, sekme yok.
        spring: 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
      transitionDuration: { DEFAULT: '200ms' },
      /**
       * `transition-colors` basma küçülmesini de kapsıyor.
       *
       * Düğmeler basılınca %97'ye iniyor (globals.css). Renk geçişi yazan
       * düğmede `transform` listede olmazsa küçülme animasyonsuz, kesik
       * oluyordu; her düğmeye ayrı sınıf eklemek yerine listeyi genişletiyoruz.
       */
      transitionProperty: {
        colors:
          'color, background-color, border-color, text-decoration-color, fill, stroke, transform',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        // Pencere ve menü girişi: Apple'da sayfa açılırken hafifçe büyüyerek
        // gelir. Yalnızca transform + opacity: düzen hesaplamasını tetiklemez.
        'sheet-in': {
          from: { opacity: '0', transform: 'translateY(6px) scale(0.97)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'pop-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms cubic-bezier(0.25, 0.1, 0.25, 1)',
        'sheet-in': 'sheet-in 280ms cubic-bezier(0.32, 0.72, 0, 1)',
        'pop-in': 'pop-in 160ms cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [],
} satisfies Config;
