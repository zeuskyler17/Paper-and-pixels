import { fileURLToPath } from 'node:url';

// Explicit config path so Tailwind works no matter which directory the server is started from.
const config = fileURLToPath(new URL('./tailwind.config.ts', import.meta.url));

export default { plugins: { tailwindcss: { config }, autoprefixer: {} } };
