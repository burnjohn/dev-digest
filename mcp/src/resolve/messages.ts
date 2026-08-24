/**
 * The error catalogue (ring M2, §5.7 · principle 4 — "errors lead
 * somewhere") — every actionable, next-step message this package returns on
 * the resolution and run paths, as DATA in ONE file rather than scattered
 * across five tool handlers (T9's `list_agents`/`get_conventions`, T10's
 * `run_agent_on_pr`/`get_findings`). That placement is what makes REQ-22
 * testable over the WHOLE catalogue rather than by example — see
 * `mcp/test/resolver.test.ts`.
 *
 * §5.7's table is the example prose this catalogue is built from — it is NOT
 * one of §5.13's six FROZEN strings, so the exact wording here is free to
 * shape as long as it keeps the property REQ-22 actually tests: every
 * message names one of the five tools. §5.7's own draft text pointed several
 * entries at DevDigest's local web UI address directly — but a URL literal is
 * banned OUTSIDE ring M3 by REQ-31/`rings.test.ts`, even one sitting in
 * message text that is never sent over the network, so no entry below ever
 * hardcodes one. `repoNotImported`/`agentDisabled` restore the address
 * anyway, without the literal, via the `webUiUrl` parameter described next.
 *
 * The "API unreachable" / "API timed out" entries are NOT here: they are
 * produced by `api/errors.ts` (ring M3), which already carries the dynamic
 * `apiBaseUrl` those messages need and is the ring that owns everything
 * `fetch` can fail with. The "blast radius" entry is not here either — its
 * shape is a structured `{implemented:false,...}` result, not a next-step
 * sentence, and belongs to the tool that registers the stub (§5.8).
 *
 * `repoNotImported` and `agentDisabled` accept an optional `webUiUrl`
 * (2026-08-23 remediation): the web-UI address is configuration exactly like
 * `apiBaseUrl` — a literal is legal in `config.ts` (M1) and illegal
 * everywhere else `rings.test.ts` checks, this file included — so it is
 * threaded in as a plain string PARAMETER by the one caller that has it
 * (`resolve/resolver.ts`, reading `ResolverDeps.webUiUrl`) rather than
 * hardcoded here. This restores the actionable address the earlier reword
 * had to drop; the parameter is optional so a caller that has not wired
 * `webUiUrl` yet still gets the (slightly less actionable) fallback text
 * instead of a broken interpolation.
 */

/** The five registered tool names (D-D) — REQ-22's test checks a message
 *  against this list before falling back to the backticked-command check. */
export const TOOL_NAMES = [
  'list_agents',
  'run_agent_on_pr',
  'get_findings',
  'get_conventions',
  'get_blast_radius',
] as const;

const MAX_CANDIDATES_SHOWN = 5;

function formatCandidates(candidates: readonly string[]): string {
  return candidates
    .slice(0, MAX_CANDIDATES_SHOWN)
    .map((c) => `\`${c}\``)
    .join(', ');
}

/**
 * "repo not imported" (§5.7). No URL LITERAL in this file — that would be
 * banned outside ring M3 by REQ-31/`rings.test.ts`. `webUiUrl` arrives as a
 * runtime string from the ONE caller that has it (`resolve/resolver.ts`,
 * `ResolverDeps.webUiUrl`, sourced from `config.ts`); when it is not
 * supplied this falls back to naming the web UI instead of addressing it.
 */
export function repoNotImported(repo: string, candidates: readonly string[], webUiUrl?: string): string {
  const known = candidates.length > 0 ? ` Imported repos: ${formatCandidates(candidates)}.` : '';
  const where = webUiUrl ? `at ${webUiUrl}` : "in DevDigest's web UI";
  return (
    `Repo \`${repo}\` is not imported into DevDigest.${known} ` +
    `Import it ${where}, then retry \`run_agent_on_pr\` or \`get_conventions\`.`
  );
}

/** "PR number unknown" (§5.7). */
export function pullNumberUnknown(repo: string, number: number, candidates: readonly string[]): string {
  const known = candidates.length > 0 ? ` Known PRs: ${formatCandidates(candidates)}.` : '';
  return `Repo \`${repo}\` has no PR #${number} in DevDigest.${known} Retry \`run_agent_on_pr\` with a known number.`;
}

/** "agent not found" (§5.7) — verbatim per the owner's own example. */
export function agentNotFound(agentName: string): string {
  return `Agent \`${agentName}\` not found — call \`list_agents\` for valid ids.`;
}

/** "agent disabled" (§5.7). `webUiUrl` — see `repoNotImported`'s comment;
 *  same fallback when it is not supplied. */
export function agentDisabled(agentName: string, webUiUrl?: string): string {
  const where = webUiUrl ? `at ${webUiUrl}/agents` : "in DevDigest's Settings";
  return (
    `Agent \`${agentName}\` is disabled. Call \`list_agents\` and pick an enabled one, ` +
    `or enable it ${where}.`
  );
}

/** "malformed repo" (§5.7). */
export function malformedRepo(repo: string): string {
  return (
    `\`repo\` must be \`owner/name\`, e.g. \`maxfurmanov/devdigest\`. Got \`${repo}\`. ` +
    'Retry `run_agent_on_pr`, `get_findings`, or `get_conventions` with a valid value.'
  );
}

/**
 * "budget exhausted" (§5.7) — NOT an error: `run_agent_on_pr` returns this
 * with `isError: false` alongside `{run_id, status:"running",
 * poll_with:"get_findings"}` (REQ-13). Consumed by T10's waiter/tool, kept
 * here so its wording is covered by the same bulk test as every other entry.
 */
export function budgetExhausted(): string {
  return 'Still running after 90s. Call `get_findings` with the same repo and pr in a minute.';
}

/** "run failed" (§5.7). Consumed by T10. */
export function runFailed(errorDetail: string): string {
  return `The run failed: \`${errorDetail}\`. Call \`list_agents\` to check the agent's model, or retry.`;
}

/**
 * Every message-producing function above, invoked with representative
 * arguments — the fixture `resolver.test.ts` walks to prove REQ-22 holds
 * over the WHOLE catalogue rather than by example.
 */
export function sampleCatalogue(): string[] {
  return [
    repoNotImported('owner/repo', ['a/b', 'c/d']),
    repoNotImported('owner/repo', []),
    pullNumberUnknown('owner/repo', 123, ['45', '46', '48']),
    pullNumberUnknown('owner/repo', 123, []),
    agentNotFound('x'),
    agentDisabled('x'),
    malformedRepo('not-a-slug'),
    budgetExhausted(),
    runFailed('model timeout'),
  ];
}
