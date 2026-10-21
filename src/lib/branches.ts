// The shop's branches. Each branch has its OWN database (customers, orders, products, inventory,
// employees, time records, users and settings are completely separate). The branch is chosen on the
// sign-in page and remembered in a cookie for the session. Safe on client and server.

export type BranchKey = 'pp' | 'keoni' | 'ky';

export type Branch = {
  key: BranchKey;
  name: string;
  short: string;
  tagline: string;
  /** Environment variable holding this branch's database URL. */
  envVar: string;
  /** Logo in /public, or null to show the initials. */
  logo: string | null;
  /** Accent colour for the branch picker / header. */
  color: string;
  /** Simple inventory: materials only (no raw-raw / raw levels, no cutting, no "used for" lines). */
  simpleInventory: boolean;
};

export const BRANCHES: Branch[] = [
  { key: 'pp', name: 'Paper & Pixels', short: 'P&P', tagline: 'Main branch · Printing & fabrication', envVar: 'DATABASE_URL', logo: '/logo.png', color: '#1452d9', simpleInventory: false },
  { key: 'keoni', name: 'Keoni Studio', short: 'KS', tagline: 'Branch · Studio', envVar: 'DATABASE_URL_KEONI', logo: null, color: '#0f766e', simpleInventory: true },
  { key: 'ky', name: 'KY Digital Photo Services', short: 'KY', tagline: 'Branch · Digital photo services', envVar: 'DATABASE_URL_KY', logo: null, color: '#b45309', simpleInventory: true },
];

export const BRANCH_COOKIE = 'pp_branch';

/** Material levels offered by each inventory mode (full = main branch, simple = branches). */
export const FULL_LEVELS = ['RAW_RAW', 'RAW', 'CONSUMABLE', 'GENERAL'] as const;
export const SIMPLE_LEVELS = ['FINISHED', 'CONSUMABLE', 'GENERAL'] as const;
export const levelsFor = (simple: boolean): readonly string[] => (simple ? SIMPLE_LEVELS : FULL_LEVELS);

export function isBranchKey(v: unknown): v is BranchKey {
  return typeof v === 'string' && BRANCHES.some((b) => b.key === v);
}

export function branchByKey(key: BranchKey): Branch {
  return BRANCHES.find((b) => b.key === key)!;
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
}
