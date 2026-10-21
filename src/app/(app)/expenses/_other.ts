// Shared by the add-expense form (client) and the server action.
/** Categories that need a typed description, e.g. "Others", "Other", "Misc". */
export function isOtherCategory(name: string | null | undefined): boolean {
  return /^(others?|misc(ellaneous)?)$/i.test((name ?? '').trim());
}

/** "Others — Pambili ng tubig" */
export function categoryLabel(name: string, otherDetail?: string | null): string {
  return otherDetail ? `${name} — ${otherDetail}` : name;
}
