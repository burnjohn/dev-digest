/**
 * Pure helpers behind the shared document-row set — filtering, reordering, and
 * the path/filename split the row anatomy renders. No React here: every
 * function is a plain array/string transform so it is trivially unit-testable
 * and identical whether a surface drives it from a pointer drag or a keyboard
 * shift.
 *
 * Prior art: `AgentEditor/_components/SkillsTab/helpers.ts` (`move`,
 * `filterByName`, `reconcileOrder`) — mirrored here for a path-keyed list
 * rather than a skill-id-keyed one.
 */

/**
 * Move the item at `from` to `to`, returning a NEW array.
 *
 * Pure and total: out-of-range indices return the list unchanged rather than
 * throwing or producing holes, which is what lets both a drop handler and a
 * keyboard shift call it with no guard clause at the call site.
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

/**
 * Move `path` one slot up (`delta = -1`) or down (`delta = 1`) within an
 * ordered path list, stepping over the immediately adjacent row exactly as a
 * drag onto that row would (REQ-36) — a no-op (same array reference back) at
 * either end of the list.
 */
export function shiftPath(list: string[], path: string, delta: -1 | 1): string[] {
  const at = list.indexOf(path);
  if (at === -1) return list;
  const target = at + delta;
  if (target < 0 || target >= list.length) return list;
  return move(list, at, target);
}

/** Case-insensitive filter over a document's repository-relative path
    (REQ-17 / the `Filter documents…` box) — never changes attached state. */
export function filterByPath<T extends { path: string }>(items: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((i) => i.path.toLowerCase().includes(q));
}

/**
 * SEED order for a path-keyed document list: attached documents first, in the
 * order the caller's attachment set has them (so the first paint's implied
 * prompt order matches what is actually persisted), then everything else
 * sorted by path.
 *
 * This is the *initial* layout only — mirrors
 * `AgentEditor/_components/SkillsTab/helpers.ts`'s `orderForDisplay` (same
 * shape, path-keyed instead of id-keyed). Once the user edits, the row order
 * is frozen (the caller freezes `order` in state and calls `reconcileOrder`
 * on every subsequent render), so a checkbox never moves the row it is on
 * (`client/INSIGHTS.md` 2026-08-16).
 */
export function orderForDisplay<T extends { path: string }>(
  all: T[],
  attachedPaths: string[],
): T[] {
  const rank = new Map(attachedPaths.map((p, i) => [p, i]));
  const attached = all
    .filter((d) => rank.has(d.path))
    .sort((a, b) => (rank.get(a.path) ?? 0) - (rank.get(b.path) ?? 0));
  const rest = all.filter((d) => !rank.has(d.path)).sort((a, b) => a.path.localeCompare(b.path));
  return [...attached, ...rest];
}

/**
 * Apply a remembered row order to the document set as it now stands: drop
 * paths that no longer exist, keep the remembered positions for the rest, and
 * append anything new (a document discovered since the row order was frozen)
 * at the end in seed order.
 *
 * This is what keeps a `Context` tab's rows at the index they occupied when
 * the tab opened (AC-14, `client/INSIGHTS.md` 2026-08-16): the caller freezes
 * `order` at the first edit and calls this on every subsequent render instead
 * of re-deriving "linked first, rest alphabetical" from the checked set.
 */
export function reconcileOrder(remembered: string[], current: string[]): string[] {
  const live = new Set(current);
  const kept = remembered.filter((p) => live.has(p));
  const seen = new Set(kept);
  return [...kept, ...current.filter((p) => !seen.has(p))];
}

/** Element-wise path comparison — lets a caller skip a write when a drag only
    stepped a row past an unattached one and the attached set itself did not
    change (mirrors `SkillsTab/helpers.ts`'s `sameIds`). */
export function samePaths(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((p, i) => p === b[i]);
}

/**
 * Split a repository-relative document path into its filename and dimmed
 * folder-path prefix for the row anatomy — `"specs/security-baseline.md"` →
 * `{ dir: "specs/", filename: "security-baseline.md" }`. A path with no `/`
 * (a document at the search root) returns an empty `dir`.
 */
export function splitDocPath(path: string): { dir: string; filename: string } {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return { dir: "", filename: path };
  return { dir: path.slice(0, idx + 1), filename: path.slice(idx + 1) };
}
