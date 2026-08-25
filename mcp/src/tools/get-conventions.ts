import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listAcceptedConventions, resolveRepoId, type ResolverDeps } from '../resolve/resolver.js';
import { registerTool } from './_register.js';
import { GetConventionsInput, GetConventionsOutput } from '../schemas/conventions.js';

/**
 * `get_conventions(repo)` (ring M4) — the house rules a repo's code already
 * follows (§5.13.5). Reads only; never reviews, never starts a run.
 *
 * A thin M4 handler, nothing more: read validated input → resolve
 * (`resolveRepoId`, ring M2) → call one application function
 * (`listAcceptedConventions`, ring M2) → map the result. Both functions live
 * in `resolve/resolver.ts` beside `resolvePull`/`resolveAgent` — they used
 * to be a private helper plus an inline accepted-only filter in THIS file,
 * because `resolve/**` belonged to another task when this tool was first
 * written (that file said so honestly rather than silently violating the
 * ring). That constraint is gone; both moved down to M2 (2026-08-23
 * remediation), which also gives the `owner/name → repo_id` cache one
 * coherent reader+writer instead of a writer in one ring and a reader in
 * another.
 */

/**
 * §5.13.5, copied character for character (D-G). 352 UTF-8 bytes, asserted
 * by `test/tools-read.test.ts`. Do not improve this string.
 */
const DESCRIPTION =
  'Return the coding conventions DevDigest extracted from a repository — the house rules its code ' +
  'actually follows. `repo` is "owner/name". Read them before writing or reviewing code in that ' +
  'repository, so the change matches existing style instead of guessing at it. Returns one line per ' +
  'convention with its status; it reviews nothing and starts no run.';

export function registerGetConventions(server: McpServer, deps: ResolverDeps): void {
  registerTool(
    server,
    'get_conventions',
    {
      title: 'Get Conventions',
      description: DESCRIPTION,
      inputSchema: GetConventionsInput,
      outputSchema: GetConventionsOutput,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const resolved = await resolveRepoId(args.repo, deps);
      if (!resolved.ok) {
        return { isError: true, text: resolved.message, structuredContent: { conventions: [] } };
      }

      const accepted = await listAcceptedConventions(resolved.repoId, deps);

      return {
        isError: false,
        text: `${accepted.length} accepted convention(s) for \`${args.repo}\`.`,
        structuredContent: { conventions: accepted },
      };
    },
  );
}
