// Reset a login's password from Terminal (e.g. the only admin forgot it).
//
//   ./scripts/reset-password.sh            (asks for branch, username and the new password)
//
// The new password is typed here, hidden, twice. It is stored only as a bcrypt hash, like the app does,
// the login is re-activated, and an audit-log line is written. Nothing else is changed.
import readline from 'node:readline';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const BRANCHES = [
  { key: 'pp', name: 'Paper & Pixels (main)', env: 'DATABASE_URL' },
  { key: 'keoni', name: 'Keoni Studio', env: 'DATABASE_URL_KEONI' },
  { key: 'ky', name: 'KY Digital Photo Services', env: 'DATABASE_URL_KY' },
];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
// Lines are queued so answers typed (or piped) ahead of a question are not lost.
const lines = [];
let waiting = null;
let closed = false;
rl.on('line', (l) => { if (waiting) { const w = waiting; waiting = null; w(l); } else lines.push(l); });
rl.on('close', () => { closed = true; if (waiting) { const w = waiting; waiting = null; w(null); } });
const nextLine = () => (lines.length ? Promise.resolve(lines.shift()) : closed ? Promise.resolve(null) : new Promise((r) => { waiting = r; }));

let muted = false;
const write = rl._writeToOutput.bind(rl);
// While muted, typed characters show as * (the password never appears on screen).
rl._writeToOutput = (str) => { if (!muted) return write(str); if (/[\r\n]/.test(str)) process.stdout.write('\n'); else process.stdout.write('*'.repeat(str.length)); };

async function ask(q) {
  process.stdout.write(q);
  const a = await nextLine();
  if (a === null) throw new Error('Cancelled.');
  return a.trim();
}

/** Ask without echoing what is typed. */
async function askHidden(q) {
  process.stdout.write(q);
  muted = true;
  try {
    const a = await nextLine();
    if (a === null) throw new Error('Cancelled.');
    return a;
  } finally {
    muted = false;
    if (!process.stdin.isTTY) process.stdout.write('\n');
  }
}

async function main() {
  console.log('\nPaper & Pixels — reset a login password\n');
  BRANCHES.forEach((b, i) => console.log(`  ${i + 1}. ${b.name}`));
  const pick = Number((await ask('\nBranch [1]: ')) || '1');
  const branch = BRANCHES[pick - 1];
  if (!branch) throw new Error('Pick 1, 2 or 3.');
  const url = process.env[branch.env];
  if (!url) throw new Error(`${branch.env} is not set in .env.`);

  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const username = ((await ask('Username [admin]: ')) || 'admin').toLowerCase();
    const user = await prisma.user.findUnique({ where: { username }, include: { accessRole: { select: { name: true } } } });
    if (!user) throw new Error(`No login "${username}" in ${branch.name}.`);
    console.log(`\n  ${user.name} (${username}) · ${user.accessRole?.name ?? 'no role'}${user.active ? '' : ' · currently deactivated'}\n`);

    const pw = await askHidden('New password (at least 6 characters): ');
    if (pw.length < 6) throw new Error('The password must be at least 6 characters.');
    const again = await askHidden('Type it again: ');
    if (pw !== again) throw new Error('The two passwords do not match. Nothing was changed.');

    const passwordHash = await bcrypt.hash(pw, 10);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash, active: true } }),
      prisma.auditLog.create({ data: { userId: user.id, action: 'RESET_PASSWORD', entity: 'User', entityId: String(user.id), summary: `Reset password of ${username} from Terminal (scripts/reset-password)` } }),
    ]);
    console.log(`\n✔ Password changed for ${username} in ${branch.name}. Sign in with the new password.\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(`\n✖ ${e.message}\n`); process.exitCode = 1; }).finally(() => rl.close());
