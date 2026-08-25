/**
 * The server `instructions` string (ring M2 — pure text assembly, no I/O) —
 * §5.13.1, D-G frozen. It is normative copy: every clause is load-bearing
 * against a numbered requirement (§5.13.7), and it is NOT a draft to
 * improve on.
 *
 * This is a FUNCTION, not a plain string constant, for a reason the plan
 * itself did not anticipate: the frozen copy's last sentence names the
 * DevDigest API address, and `mcp/test/rings.test.ts`'s REQ-31 guard bans a
 * bare URL-scheme literal (the "colon-slash-slash" prefix) in every file
 * under `mcp/src/**` except `api/**` and `config.ts` — a scan that also
 * walks doc comments, so the address cannot appear here even in PROSE, not
 * even spelled out to explain this rule. `resolve/messages.ts` hit the
 * identical wall for `webUiUrl` and solved it the same way: thread the
 * dynamic value in as a parameter from the one ring that is allowed to hold
 * it (`config.ts`, M1) rather than hardcode it. `server.ts` (M5) is the sole
 * caller, passing `config.apiBaseUrl` — the rendered default is
 * character-for-character §5.13.1's approved copy (measured at exactly 557
 * UTF-8 bytes by `test/protocol.test.ts`), so D-G's promise holds exactly as
 * written even though the source file itself carries no literal.
 */
export function buildInstructions(apiBaseUrl: string): string {
  return [
    "DevDigest runs AI code review on GitHub pull requests locally. Search this server when the " +
      'user asks to review a pull request, wants the findings of a review that already ran, asks ' +
      "which reviewer agents are configured, or asks about a repository's coding conventions.",
    'Typical arc: `list_agents` for a valid agent id, then `run_agent_on_pr` to review, then ' +
      '`get_findings` to re-read the result later.',
    'Every tool takes `repo` as "owner/name" and `pr` as the pull request number. Requires the ' +
      `DevDigest API at ${apiBaseUrl} (\`cd server && pnpm dev\`).`,
  ].join('\n\n');
}
