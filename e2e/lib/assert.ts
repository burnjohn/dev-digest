/**
 * Tiny helpers for the e2e runner. Assertions are intentionally minimal: most
 * of the "assert" work is done by agent-browser's own `wait --text` / `wait --url`
 * commands, which exit non-zero when the condition isn't met within the timeout.
 * These helpers only cover the extra substring checks and result bookkeeping.
 */

/** A single agent-browser invocation within a flow. */
export interface Step {
  /** agent-browser argv, e.g. ["wait", "--text", "#482"]. `{BASE}` is substituted. */
  cmd: string[];
  /** Human label for logs (defaults to the joined cmd). */
  label?: string;
  /** Optional extra check on the command's stdout (beyond its exit code). */
  assert?: { stdoutIncludes?: string };
}

export interface Flow {
  name: string;
  description?: string;
  /**
   * Flow writes to the shared DB / browser session (e.g. deletes seeded data).
   * Mutating flows always run AFTER every read-only flow — never by lexical
   * accident — because all flows share one seeded DB and browser session.
   */
  mutates?: boolean;
  steps: Step[];
}

export interface StepResult {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface FlowResult {
  name: string;
  ok: boolean;
  steps: StepResult[];
}

/**
 * Order flows for execution: all read-only flows first, then all mutating ones,
 * stable lexical order within each group. Flows share one DB and one browser
 * session, so a mutating flow (e.g. 08 deletes the seeded GitHub token) running
 * before a read-only flow would silently invalidate that flow's seeded-data
 * assumptions. Fails loudly if the produced order would ever run a mutating
 * flow before a read-only one (defensive invariant against future edits).
 */
export function orderFlows<T extends { file: string; flow: Flow }>(flows: T[]): T[] {
  const byFile = (a: T, b: T) => a.file.localeCompare(b.file);
  const ordered = [
    ...flows.filter((f) => !f.flow.mutates).sort(byFile),
    ...flows.filter((f) => f.flow.mutates).sort(byFile),
  ];
  let firstMutating: string | undefined;
  for (const item of ordered) {
    if (item.flow.mutates) {
      firstMutating ??= item.file;
    } else if (firstMutating) {
      throw new Error(
        `flow ordering violated: mutating flow ${firstMutating} would run before read-only flow ${item.file}`,
      );
    }
  }
  return ordered;
}

/** Substitute `{BASE}` (and trim a trailing slash on BASE) in every arg. */
export function resolveArgs(cmd: string[], base: string): string[] {
  const b = base.replace(/\/+$/, "");
  return cmd.map((a) => a.replaceAll("{BASE}", b));
}

export function stdoutContains(stdout: string, needle: string): boolean {
  return stdout.includes(needle);
}

export function summarize(results: FlowResult[]): string {
  const lines: string[] = [];
  for (const f of results) {
    lines.push(`${f.ok ? "PASS" : "FAIL"}  ${f.name}`);
    for (const s of f.steps) {
      if (!s.ok) lines.push(`        ✗ ${s.label}${s.detail ? ` — ${s.detail}` : ""}`);
    }
  }
  const passed = results.filter((r) => r.ok).length;
  lines.push("");
  lines.push(`${passed}/${results.length} flows passed`);
  return lines.join("\n");
}
