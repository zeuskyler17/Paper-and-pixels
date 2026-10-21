import { PrismaClient, Prisma } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { workUnitAsyncStorage } from 'next/dist/server/app-render/work-unit-async-storage.external';
import { BRANCHES, BRANCH_COOKIE, branchByKey, isBranchKey, type BranchKey } from './branches';

/**
 * One Prisma client per branch database. `prisma` below is a proxy that picks the client for the
 * branch of the current request (the pp_branch cookie set at sign-in), or the branch set explicitly
 * with withBranch() (sign-in itself, scripts). With no branch it throws — never silently falls back
 * to another branch's data.
 */
const als = new AsyncLocalStorage<BranchKey>();
const g = globalThis as typeof globalThis & { __ppClients?: Map<BranchKey, PrismaClient> };
const clients = g.__ppClients ?? (g.__ppClients = new Map());

export function clientFor(key: BranchKey): PrismaClient {
  let c = clients.get(key);
  if (!c) {
    const b = branchByKey(key);
    const url = process.env[b.envVar];
    if (!url) throw new Error(`${b.name} has no database configured (${b.envVar} missing in .env).`);
    c = new PrismaClient({ datasourceUrl: url });
    clients.set(key, c);
  }
  return c;
}

function branchFromRequest(): BranchKey | null {
  try {
    const store = workUnitAsyncStorage.getStore();
    if (!store || store.type !== 'request') return null;
    const v = store.cookies.get(BRANCH_COOKIE)?.value;
    return isBranchKey(v) ? v : null;
  } catch {
    return null;
  }
}

/** Branch of the current request / explicit scope, or null when not signed in to any branch. */
export function currentBranch(): BranchKey | null {
  return als.getStore() ?? branchFromRequest();
}

/** Run `fn` against a specific branch (sign-in, maintenance scripts). */
export function withBranch<T>(key: BranchKey, fn: () => Promise<T>): Promise<T> {
  return als.run(key, fn);
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    if (prop === 'then') return undefined; // never awaitable
    const key = currentBranch();
    if (!key) throw new Error('No branch selected — please sign in again.');
    const c = clientFor(key) as unknown as Record<string | symbol, unknown>;
    const v = c[prop];
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(c) : v;
  },
});

export { BRANCHES };

/** Transaction client type, for helpers that must run inside prisma.$transaction(). */
export type Tx = Prisma.TransactionClient;
