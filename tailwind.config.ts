import type { Config } from 'tailwindcss';

export default {
  content: { relative: true, files: ['./src/**/*.{ts,tsx}'] },
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        // "font-mono" is used for figures (money, qty, codes). It is IBM Plex Sans with tabular digits
        // (see globals.css) — easier to read than a typewriter font, and columns still line up.
        mono: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Royal blue from the Paper and Pixels logo — the one brand accent. Graphite / steel for everything else.
        // (Red is reserved for warnings: overdue, errors, voids.)
        brand: { 50: '#eef5ff', 100: '#d9e8ff', 200: '#b8d4ff', 500: '#1f6ff0', 600: '#1452d9', 700: '#1143b4', 800: '#0f388f', 900: '#0b2766' },
        // Cyan highlight from the logo gradient.
        pixel: { 400: '#3ec3f5', 500: '#19a9ee' },
        // Graphite for chrome (sidebar, headers).
        graphite: { 700: '#2a313b', 800: '#1d232b', 900: '#14191f', 950: '#0d1115' },
      },
      borderRadius: { DEFAULT: '3px', md: '4px', lg: '6px' },
      boxShadow: {
        panel: '0 1px 0 rgba(16,24,40,0.04), 0 1px 2px rgba(16,24,40,0.04)',
      },
    },
  },
  plugins: [],
} satisfies Config;
