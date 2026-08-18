/**
 * Move the item at `from` to `to`, returning a NEW array.
 *
 * Pure and total: out-of-range indices return the list unchanged rather than
 * throwing or producing holes, which is what lets the ▲▼ buttons at the ends be
 * wired up without guard clauses at every call site.
 */
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to) return list;
  if (from < 0 || from >= list.length) return list;
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return list;
  next.splice(to, 0, item);
  return next;
}

/** Case-insensitive filter over a skill's visible identity fields. */
export function filterByName<T extends { name: string; description: string }>(
  items: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (i) => i.name.toLowerCase().includes(q) || i.description.toLowerCase().includes(q),
  );
}

/**
 * SEED order for the full skill list: linked skills first, in link order, then
 * everything else alphabetically.
 *
 * This is the *initial* layout only. Once the user edits, the row order is
 * frozen (see `reconcileOrder`) so a checkbox never moves the row it is on.
 */
export function orderForDisplay<T extends { id: string; name: string }>(
  all: T[],
  linkedIds: string[],
): T[] {
  const rank = new Map(linkedIds.map((id, i) => [id, i]));
  const linked = all
    .filter((s) => rank.has(s.id))
    .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  const rest = all.filter((s) => !rank.has(s.id)).sort((a, b) => a.name.localeCompare(b.name));
  return [...linked, ...rest];
}

/**
 * Apply a remembered row order to the skill set as it is *now*: drop ids that
 * no longer exist, keep the remembered positions for the rest, and append
 * anything new (a skill authored elsewhere) at the end in seed order.
 */
export function reconcileOrder(remembered: string[], current: string[]): string[] {
  const live = new Set(current);
  const kept = remembered.filter((id) => live.has(id));
  const seen = new Set(kept);
  return [...kept, ...current.filter((id) => !seen.has(id))];
}

/**
 * Element-wise id comparison.
 *
 * A drag that only steps a row past an *unlinked* one changes the rows the user
 * sees but not the sequence the prompt is assembled from; comparing the two
 * derived prompt orders is how the caller tells that case apart and skips a
 * write the server would take as a no-op anyway.
 */
export function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
