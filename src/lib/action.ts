// Shared result type for server actions used with <ActionForm>.
export type ActionState = { error?: string; ok?: string } | null;

export function fail(error: string): ActionState {
  return { error };
}

/** Wrap an action body so thrown errors become a friendly { error } result. */
export async function attempt(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: 'Saved.' };
  } catch (e: unknown) {
    // Let Next.js redirect()/notFound() propagate.
    if (e && typeof e === 'object' && 'digest' in e && String((e as { digest: unknown }).digest).startsWith('NEXT_')) throw e;
    const msg = e instanceof Error ? e.message : 'Something went wrong.';
    logActionError(e);
    return { error: msg };
  }
}

export function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? '').trim();
}

export function optStr(fd: FormData, key: string): string | null {
  const v = str(fd, key);
  return v === '' ? null : v;
}

export function num(fd: FormData, key: string): number {
  const v = str(fd, key);
  return v === '' ? NaN : Number(v);
}

export function optInt(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  return v === '' ? null : Number.parseInt(v, 10);
}

/**
 * Log a failed action as plain text. (Passing Error objects from Prisma transactions to
 * console.error crashes Next 15's dev error overlay, hiding the friendly message.)
 */
export function logActionError(e: unknown) {
  const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  console.warn(`[action] ${msg}`);
}
