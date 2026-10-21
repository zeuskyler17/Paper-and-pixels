import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma, currentBranch } from './db';
import { BRANCH_COOKIE, branchByKey, isBranchKey, type Branch, type BranchKey } from './branches';
import { SESSION_COOKIE, signSession, verifySession } from './session';
import { ALL_PERMISSIONS, can, homeFor, type Need } from './permissions';

export type SessionUser = {
  id: number;
  name: string;
  username: string;
  /** Locked Admin (owner) role: full access. */
  isAdmin: boolean;
  roleId: number | null;
  roleName: string;
  permissions: string[];
};

const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 60 * 60 * 12 };

export async function createSession(user: { id: number }, branch: BranchKey) {
  const token = await signSession({ uid: user.id, b: branch });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, COOKIE_OPTS);
  jar.set(BRANCH_COOKIE, branch, COOKIE_OPTS); // routes every database call of this session to the branch
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(BRANCH_COOKIE);
}

/** The branch this request is signed in to (null on the sign-in page). */
export function getBranch(): Branch | null {
  const k = currentBranch();
  return k ? branchByKey(k) : null;
}

/** Load a user's access (role + permissions) from the database. */
export async function loadUser(id: number): Promise<SessionUser | null> {
  const u = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, username: true, active: true, accessRole: true },
  });
  if (!u || !u.active) return null;
  const r = u.accessRole;
  const isAdmin = !!r?.isAdmin;
  return {
    id: u.id, name: u.name, username: u.username, isAdmin,
    roleId: r?.id ?? null,
    roleName: r?.name ?? 'No role',
    permissions: isAdmin ? [...ALL_PERMISSIONS] : (r?.permissions ?? []),
  };
}

/** Current user, re-checked against the DB on every request (deactivated users and role changes apply immediately). */
export async function getUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  // The token and the branch cookie must agree, otherwise a cookie could point a login at another branch.
  const branch = jar.get(BRANCH_COOKIE)?.value;
  if (!isBranchKey(branch) || branch !== session.b) return null;
  return loadUser(session.uid);
}

/** For pages: redirects to /login, or to the user's home page if the permission is missing. `need` = any of. */
export async function requireUser(need?: Need | Need[]): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect('/login');
  if (need && !can(user, need)) redirect(homeFor(user));
  return user;
}

/** For server actions: throws instead of redirecting. `need` = any of. */
export async function assertUser(need?: Need | Need[]): Promise<SessionUser> {
  const user = await getUser();
  if (!user) throw new Error('Your session has expired. Please log in again.');
  if (need && !can(user, need)) throw new Error('You do not have permission to do this.');
  return user;
}

export { can, homeFor };
