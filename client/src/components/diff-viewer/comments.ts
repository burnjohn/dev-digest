/* Inline-comment support for the DiffViewer (Files changed tab).
   Pure helpers + the API shape the viewer needs; React bits live in
   CommentThreadView/, InlineComposer/, and OutdatedComments/. Comments are
   GitHub PR review comments, proxied live. */
import type { CSSProperties } from "react";
import type { PrReviewComment } from "@/lib/types";
import type { Line } from "./helpers";

/** What the viewer needs to read + write inline comments. */
export interface DiffCommentApi {
  comments: PrReviewComment[];
  canComment: boolean;
  /** When false, existing comment threads are hidden (the "+" still works). */
  showComments: boolean;
  posting: boolean;
  onSubmit: (input: {
    path: string;
    line: number;
    side: "LEFT" | "RIGHT";
    body: string;
    in_reply_to?: number;
  }) => Promise<unknown>;
}

/** One review-comment thread anchored to a diff line (or outdated). */
export interface CommentThread {
  rootId: number;
  comments: PrReviewComment[];
  line: number | null;
  side: "LEFT" | "RIGHT";
  isOutdated: boolean;
}

/** `${side}:${line}` — the key a thread/line is matched on. */
export function lineKey(side: "LEFT" | "RIGHT", line: number | null | undefined): string | null {
  return line == null ? null : `${side}:${line}`;
}

/** Group flat comments into threads (root + replies), ordered oldest-first. */
export function buildThreads(comments: PrReviewComment[]): CommentThread[] {
  const byRoot = new Map<number, PrReviewComment[]>();
  for (const c of comments) {
    const rootId = c.in_reply_to_id ?? c.id;
    const list = byRoot.get(rootId) ?? [];
    list.push(c);
    byRoot.set(rootId, list);
  }
  const threads: CommentThread[] = [];
  for (const [rootId, list] of byRoot) {
    const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const root = sorted.find((c) => c.id === rootId) ?? sorted[0]!;
    threads.push({
      rootId,
      comments: sorted,
      line: root.line,
      side: root.side,
      isOutdated: root.line == null,
    });
  }
  return threads;
}

/** Keys a parsed line can host a thread on (RIGHT=new line, LEFT=old line). */
export function keysForLine(ln: Line): string[] {
  const keys: string[] = [];
  if (ln.kind === "add" || ln.kind === "ctx") {
    const k = lineKey("RIGHT", ln.newNo);
    if (k) keys.push(k);
  }
  if (ln.kind === "del" || ln.kind === "ctx") {
    const k = lineKey("LEFT", ln.oldNo);
    if (k) keys.push(k);
  }
  return keys;
}

/** The (line, side) a "+" on this row should comment on, or null if none. */
export function commentTargetFor(ln: Line): { line: number; side: "LEFT" | "RIGHT" } | null {
  if ((ln.kind === "add" || ln.kind === "ctx") && ln.newNo != null)
    return { line: ln.newNo, side: "RIGHT" };
  if (ln.kind === "del" && ln.oldNo != null) return { line: ln.oldNo, side: "LEFT" };
  return null;
}

/**
 * Split threads into those that match a rendered line (keyed) and "outdated"
 * ones GitHub can no longer anchor (or whose line isn't in this patch). The
 * outdated bucket is surfaced separately so nothing is silently dropped.
 */
export function partitionThreads(
  threads: CommentThread[],
  renderedKeys: Set<string>,
): { matched: Map<string, CommentThread[]>; outdated: CommentThread[] } {
  const matched = new Map<string, CommentThread[]>();
  const outdated: CommentThread[] = [];
  for (const th of threads) {
    const key = th.line != null ? `${th.side}:${th.line}` : null;
    if (key && renderedKeys.has(key)) {
      const list = matched.get(key) ?? [];
      list.push(th);
      matched.set(key, list);
    } else {
      outdated.push(th);
    }
  }
  return { matched, outdated };
}

// ---- styles (layout only; cards/inputs/buttons reuse @devdigest/ui) ----
export const cs = {
  rowWrap: { position: "relative" } satisfies CSSProperties,
  addBtn: {
    position: "absolute",
    left: 2,
    top: "50%",
    transform: "translateY(-50%)",
    width: 18,
    height: 18,
    borderRadius: 5,
    border: "none",
    background: "var(--accent)",
    color: "#fff",
    fontSize: 14,
    lineHeight: "18px",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    zIndex: 1,
    boxShadow: "0 1px 3px rgba(0,0,0,.35)",
  } satisfies CSSProperties,
  /** Indented rail for threads/composer, aligned under the code (past gutter). */
  thread: {
    margin: "6px 14px 8px 58px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  headRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 } satisfies CSSProperties,
  user: { fontWeight: 600, fontSize: 13, color: "var(--text-primary)" } satisfies CSSProperties,
  time: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  ghLink: {
    fontSize: 12,
    color: "var(--text-muted)",
    textDecoration: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  } satisfies CSSProperties,
  mdBody: {
    fontSize: 13,
    lineHeight: "19px",
    color: "var(--text-secondary)",
    wordBreak: "break-word",
  } satisfies CSSProperties,
  composerActions: { display: "flex", gap: 8, alignItems: "center", marginTop: 8 } satisfies CSSProperties,
  hint: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  outdatedWrap: {
    borderTop: "1px solid var(--border)",
    margin: "4px 14px 4px 58px",
    paddingTop: 10,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,
  outdatedTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
