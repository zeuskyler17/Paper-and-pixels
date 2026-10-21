// Generates the English voice-over for each tutorial slide with the macOS voice.
// Run: node scripts/tutorial-audio.mjs   (re-run after editing slides.ts)
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const src = readFileSync(new URL('../src/app/(app)/tutorial/slides.ts', import.meta.url), 'utf8');
const slides = [...src.matchAll(/id: '([^']+)'[\s\S]*?say: '((?:[^'\\]|\\.)*)'/g)].map((m) => ({ id: m[1], say: m[2].replace(/\\'/g, "'") }));
const dir = new URL('../public/tutorial/audio/', import.meta.url);
mkdirSync(dir, { recursive: true });
for (const s of slides) {
  execFileSync('say', ['-v', 'Samantha', '-r', '168', '-o', fileURLToPath(new URL(`${s.id}.m4a`, dir)), '--data-format=aac', s.say]);
  process.stdout.write(`${s.id} `);
}
console.log(`\n${slides.length} audio files written`);
