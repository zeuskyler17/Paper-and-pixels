// One-time setup of a branch database: roles (Admin + presets), shop name, and the owner's login.
// Usage: npx tsx --tsconfig tsconfig.json scripts/branch-init.ts <pp|keoni|ky> "<Owner display name>"
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { BRANCHES, isBranchKey } from '../src/lib/branches';
import { PRESET_ROLES, EXTRA_PRESET_ROLES } from '../src/lib/permissions';

const key = process.argv[2]; const ownerName = process.argv[3] || 'Owner';
if (!isBranchKey(key)) { console.error('branch must be one of', BRANCHES.map((b) => b.key).join(', ')); process.exit(1); }
const branch = BRANCHES.find((b) => b.key === key)!;
const url = process.env[branch.envVar]; if (!url) { console.error(`${branch.envVar} is not set`); process.exit(1); }
const p = new PrismaClient({ datasourceUrl: url });

(async () => {
  const admin = await p.accessRole.upsert({ where: { name: 'Admin (owner)' }, update: {}, create: { name: 'Admin (owner)', description: 'Full access to everything. Locked.', isAdmin: true, sortOrder: 0 } });
  for (const [i, r] of PRESET_ROLES.entries()) await p.accessRole.upsert({ where: { name: r.name }, update: {}, create: { name: r.name, description: r.description, permissions: r.permissions, sortOrder: i + 1 } });
  for (const [i, r] of EXTRA_PRESET_ROLES.entries()) await p.accessRole.upsert({ where: { name: r.name }, update: {}, create: { ...r, sortOrder: PRESET_ROLES.length + i + 1 } });
  await p.setting.upsert({ where: { key: 'shop_name' }, update: {}, create: { key: 'shop_name', value: branch.name } });
  let password: string | null = null;
  if (!(await p.user.findUnique({ where: { username: 'owner' } }))) {
    password = randomBytes(6).toString('base64url').replace(/[-_]/g, 'x').slice(0, 10);
    await p.user.create({ data: { name: ownerName, username: 'owner', role: 'ADMIN', accessRoleId: admin.id, passwordHash: await bcrypt.hash(password, 10) } });
  }
  console.log(JSON.stringify({ branch: branch.name, roles: await p.accessRole.count(), users: await p.user.count(), ownerUsername: 'owner', temporaryPassword: password ?? '(already set)' }));
  await p.$disconnect();
})();
