import 'server-only';
import bcrypt from 'bcryptjs';
import type { Tx } from './db';

/*
 * Owner approval PIN — required to void a payment or give a discount.
 * Each ADMIN sets their own 4–8 digit PIN (My account → Approval PIN). A PIN is matched against
 * every active admin; the matching admin is recorded as the approver. The PIN is never stored or logged.
 * 5 wrong PINs from the same logged-in user lock approvals for that user for 5 minutes.
 */

const MAX_FAILS = 5;
const LOCK_MS = 5 * 60_000;
const g = globalThis as unknown as { approvalFails?: Map<number, { fails: number; until: number }> };
const fails = (g.approvalFails ??= new Map());

export function isValidPin(pin: string) {
  return /^\d{4,8}$/.test(pin) && !/^(\d)\1+$/.test(pin);
}

export async function hashApprovalPin(pin: string) {
  return bcrypt.hash(pin, 10);
}

export async function verifyApprovalPin(
  tx: Tx,
  pin: string | null | undefined,
  requesterId: number,
  what = 'this',
): Promise<{ id: number; name: string }> {
  const f = fails.get(requesterId);
  if (f && f.until > Date.now()) {
    const mins = Math.ceil((f.until - Date.now()) / 60_000);
    throw new Error(`Too many wrong approval PINs. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`);
  }
  if (!pin) throw new Error(`The owner's approval PIN is required to approve ${what}.`);
  const admins = await tx.user.findMany({
    where: { accessRole: { isAdmin: true }, active: true, approvalPinHash: { not: null } },
    select: { id: true, name: true, approvalPinHash: true },
  });
  if (admins.length === 0) throw new Error('No approval PIN has been set yet. The owner can set one in My account → Approval PIN.');
  for (const a of admins) {
    if (await bcrypt.compare(pin, a.approvalPinHash!)) { fails.delete(requesterId); return { id: a.id, name: a.name }; }
  }
  const n = (f && f.until <= Date.now() && f.fails >= MAX_FAILS ? 0 : f?.fails ?? 0) + 1;
  fails.set(requesterId, { fails: n, until: n >= MAX_FAILS ? Date.now() + LOCK_MS : 0 });
  await new Promise((r) => setTimeout(r, 600)); // slow down guessing
  throw new Error(n >= MAX_FAILS ? 'Too many wrong approval PINs. Locked for 5 minutes.' : `Wrong approval PIN. Nothing was saved.`);
}
