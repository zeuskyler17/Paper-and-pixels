import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';
import plugin from 'tailwindcss/plugin';

/*
 * Theme
 * ─────
 * The app runs in dark mode by default (class "theme-dark" on the app shell). Rather than adding `dark:`
 * variants to every page, the neutral scale (slate) and the light tints of the status colours (50–300) are
 * CSS variables: light values on :root, a tuned dark scale under .theme-dark. Text in the 600–900 shades of
 * a status colour is lifted to a lighter shade in dark mode so it stays readable (WCAG 4.5:1 on the cards).
 *
 * ".theme-light" puts a subtree back on the light values — used for the graphite sidebar (already dark),
 * the time-clock kiosk and in-app documents (payslip). Print pages (/print/…) never get .theme-dark, and
 * every dark rule is screen-only, so A5 printouts and window.print() always come out light.
 */

const BRAND = { 50: '#eef5ff', 100: '#d9e8ff', 200: '#b8d4ff', 300: '#8fbcff', 400: '#5b9bff', 500: '#1f6ff0', 600: '#1452d9', 700: '#1143b4', 800: '#0f388f', 900: '#0b2766' };

// Dark surfaces (from the UI/UX Pro Max dark-dashboard palette, tuned to the graphite brand chrome).
const DARK = { canvas: '#0a0f17', surface: '#111925', field: '#0d141f', raised: '#162030' };
const LIGHT = { canvas: '#eef0f3', surface: '#ffffff', field: '#ffffff', raised: '#ffffff' };

const SLATE_DARK: Record<string, string> = {
  50: '#162030', 100: '#1b2637', 200: '#263348', 300: '#35455d', 400: '#8292aa',
  500: '#98a6ba', 600: '#aebacb', 700: '#cbd5e1', 800: '#e2e8f0', 900: '#f1f5f9', 950: '#f8fafc',
};

const FAMILIES = ['red', 'amber', 'emerald', 'green', 'sky', 'blue', 'violet', 'orange', 'yellow', 'rose', 'brand'] as const;
type Family = (typeof FAMILIES)[number];
const scale = (f: Family): Record<string, string> => (f === 'brand' ? BRAND : (colors as unknown as Record<string, Record<string, string>>)[f]);
const TINT_SHADES = ['50', '100', '200', '300'] as const;
const TINT_MIX: Record<string, number> = { 50: 0.12, 100: 0.18, 200: 0.3, 300: 0.45 };

const rgb = (hex: string) => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const triplet = (hex: string) => rgb(hex).join(' ');
/** `top` laid over `base` at opacity t, as "r g b". */
const mix = (top: string, base: string, t: number) => {
  const a = rgb(top), b = rgb(base);
  return a.map((v, i) => Math.round(v * t + b[i] * (1 - t))).join(' ');
};
const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

function lightVars(): Record<string, string> {
  const out: Record<string, string> = {
    '--canvas': triplet(LIGHT.canvas), '--surface': triplet(LIGHT.surface), '--field': triplet(LIGHT.field), '--raised': triplet(LIGHT.raised),
  };
  for (const [k, hex] of Object.entries(colors.slate)) out[`--c-slate-${k}`] = triplet(hex);
  for (const f of FAMILIES) for (const s of TINT_SHADES) out[`--c-${f}-${s}`] = triplet(scale(f)[s]);
  return out;
}
function darkVars(): Record<string, string> {
  const out: Record<string, string> = {
    '--canvas': triplet(DARK.canvas), '--surface': triplet(DARK.surface), '--field': triplet(DARK.field), '--raised': triplet(DARK.raised),
  };
  for (const [k, hex] of Object.entries(SLATE_DARK)) out[`--c-slate-${k}`] = triplet(hex);
  for (const f of FAMILIES) for (const s of TINT_SHADES) out[`--c-${f}-${s}`] = mix(scale(f)['500'], DARK.surface, TINT_MIX[s]);
  return out;
}
/** Readable text shades on dark cards: 600/700 → 400, 800 → 300, 900 → 200 (brand has its own lifted blues). */
function darkText(f: Family): Record<string, string> {
  if (f === 'brand') return { 600: '#5b9bff', 700: '#7aaeff', 800: '#a3c7ff', 900: '#cfe0ff' };
  const c = scale(f);
  return { 600: c['400'], 700: c['400'], 800: c['300'], 900: c['200'] };
}

const varColor = (f: Family) => ({ ...scale(f), ...Object.fromEntries(TINT_SHADES.map((s) => [s, v(`${f}-${s}`)])) });

const DARK_SCOPE = '.theme-dark';
const NOT_LIGHT = ':not(.theme-light, .theme-light *)';

const themePlugin = plugin(({ addBase }) => {
  const darkRules: Record<string, Record<string, string>> = {
    [DARK_SCOPE]: { ...darkVars(), 'color-scheme': 'dark', '--tw-ring-offset-color': DARK.surface },
    '.theme-dark .theme-light': { ...lightVars(), 'color-scheme': 'light', '--tw-ring-offset-color': '#ffffff' },
  };
  for (const f of FAMILIES) {
    for (const [shade, hex] of Object.entries(darkText(f))) {
      darkRules[`${DARK_SCOPE} .text-${f}-${shade}${NOT_LIGHT}`] = { color: hex };
      darkRules[`${DARK_SCOPE} .hover\\:text-${f}-${shade}:hover${NOT_LIGHT}`] = { color: hex };
    }
  }
  // Plain white surfaces written as utilities (bg-white, bg-white/95…) follow the theme's card colour.
  for (const [cls, a] of [['bg-white', '1'], ['bg-white\\/95', '0.95'], ['bg-white\\/90', '0.9'], ['bg-white\\/80', '0.8'], ['bg-white\\/70', '0.7'], ['bg-white\\/60', '0.6']] as const) {
    darkRules[`${DARK_SCOPE} .${cls}${NOT_LIGHT}, ${DARK_SCOPE}.${cls}`] = { 'background-color': `rgb(var(--surface) / ${a})` };
  }
  darkRules[`${DARK_SCOPE} .hover\\:bg-white:hover${NOT_LIGHT}, ${DARK_SCOPE} .focus\\:bg-white:focus${NOT_LIGHT}`] = { 'background-color': 'rgb(var(--raised))' };
  addBase({ ':root': lightVars(), '@media screen': darkRules });
});

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
        // Neutral scale follows the theme (see the note at the top).
        slate: Object.fromEntries(Object.keys(colors.slate).map((k) => [k, v(`slate-${k}`)])),
        ...Object.fromEntries(FAMILIES.filter((f) => f !== 'brand').map((f) => [f, varColor(f)])),
        // Royal blue from the Paper and Pixels logo — the one brand accent. Graphite / steel for everything else.
        // (Red is reserved for warnings: overdue, errors, voids.)
        brand: varColor('brand'),
        // Cyan highlight from the logo gradient.
        pixel: { 300: '#7dd8f8', 400: '#3ec3f5', 500: '#19a9ee' },
        // Graphite for chrome (sidebar, headers).
        graphite: { 700: '#2a313b', 800: '#1d232b', 900: '#14191f', 950: '#0d1115' },
        // Theme surfaces: page background, cards, form fields, raised (hover) surfaces.
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        field: 'rgb(var(--field) / <alpha-value>)',
        raised: 'rgb(var(--raised) / <alpha-value>)',
      },
      borderRadius: { DEFAULT: '3px', md: '4px', lg: '6px' },
      boxShadow: {
        panel: '0 1px 0 rgba(16,24,40,0.04), 0 1px 2px rgba(16,24,40,0.04)',
      },
    },
  },
  plugins: [themePlugin],
} satisfies Config;
