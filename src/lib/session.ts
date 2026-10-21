// Edge-safe session token helpers (used by middleware and server code).
// Access rules (permissions) are NOT in the token: they are loaded from the database on every
// request in lib/auth.ts, so a role change applies immediately.
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'pp_session';
import { isBranchKey, type BranchKey } from './branches';

export type SessionPayload = { uid: number; b: BranchKey };

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error('AUTH_SECRET is missing or too short (min 16 chars).');
  return new TextEncoder().encode(s);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const uid = Number(payload.uid);
    const b = payload.b;
    return Number.isInteger(uid) && uid > 0 && isBranchKey(b) ? { uid, b } : null;
  } catch {
    return null;
  }
}
