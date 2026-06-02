#!/usr/bin/env node
/**
 * DevDigest MCP server (stdio transport, L04, §11).
 *
 * Exposes the six tools from the spec for Claude Code / Cursor:
 *   read_pr · grep_repo · read_file · review_diff · read_memory · blast_radius
 *
 * Tools that need cross-repo / engine state (read_pr, blast_radius, read_memory,
 * review_diff of an imported PR) call the DevDigest HTTP engine via
 * DevDigestClient. Tools that operate on the local checkout (grep_repo,
 * read_file, and review_diff of the WORKING diff) use the local helpers so they
 * work pre-push on uncommitted changes.
 *
 * NOTE: requires `@modelcontextprotocol/sdk` (declared in package.json; the
 * orchestrator installs at the checkpoint — see report). Run with:
 *   node dist/server.js            # after build
 *   tsx src/server.ts              # dev
 * and register in your MCP client config with command `devdigest-mcp`.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DevDigestClient } from './client.js';
import { grepRepo, readRepoFile, workingDiff, pushDiff } from './local.js';

const client = new DevDigestClient();

const server = new McpServer({
  name: 'devdigest',
  version: '0.1.0',
});

function text(value: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errText(err: unknown) {
  return {
    isError: true,
    content: [{ type: 'text' as const, text: `Error: ${(err as Error).message}` }],
  };
}

// ---- read_pr -------------------------------------------------------------
server.registerTool(
  'read_pr',
  {
    title: 'Read a pull request',
    description: 'Fetch full PR detail (diff, files, commits, body, linked issue) by PR id.',
    inputSchema: { prId: z.string().describe('DevDigest pull request id (UUID)') },
  },
  async ({ prId }) => {
    try {
      return text(await client.readPr(prId));
    } catch (e) {
      return errText(e);
    }
  },
);

// ---- blast_radius --------------------------------------------------------
server.registerTool(
  'blast_radius',
  {
    title: 'Blast radius for a PR',
    description:
      'Changed symbols + downstream callers + endpoints/crons affected + a one-line summary.',
    inputSchema: { prId: z.string().describe('DevDigest pull request id (UUID)') },
  },
  async ({ prId }) => {
    try {
      return text(await client.blastRadius(prId));
    } catch (e) {
      return errText(e);
    }
  },
);

// ---- read_memory ---------------------------------------------------------
server.registerTool(
  'read_memory',
  {
    title: 'Read curated memory',
    description: 'Curated decisions/conventions/preferences. Optional scope and kind filters.',
    inputSchema: {
      scope: z.enum(['repo', 'global', 'team']).optional(),
      kind: z.enum(['decision', 'convention', 'preference', 'fact', 'learning']).optional(),
    },
  },
  async ({ scope, kind }) => {
    try {
      return text(await client.readMemory({ scope, kind }));
    } catch (e) {
      return errText(e);
    }
  },
);

// ---- grep_repo (local working tree) --------------------------------------
server.registerTool(
  'grep_repo',
  {
    title: 'Grep the local repo',
    description: 'Search the current checkout (git grep, respects .gitignore). Returns path:line:text.',
    inputSchema: {
      pattern: z.string().describe('Regex/string to search for'),
      cwd: z.string().optional().describe('Repo dir (default: process cwd)'),
    },
  },
  async ({ pattern, cwd }) => {
    try {
      return text(grepRepo(pattern, cwd));
    } catch (e) {
      return errText(e);
    }
  },
);

// ---- read_file (local working tree) --------------------------------------
server.registerTool(
  'read_file',
  {
    title: 'Read a repo file',
    description: 'Read a file from the current checkout (path-traversal guarded).',
    inputSchema: {
      path: z.string().describe('Path relative to the repo root'),
      cwd: z.string().optional(),
    },
  },
  async ({ path, cwd }) => {
    try {
      return text(readRepoFile(path, cwd));
    } catch (e) {
      return errText(e);
    }
  },
);

// ---- review_diff ---------------------------------------------------------
server.registerTool(
  'review_diff',
  {
    title: 'Review a diff',
    description:
      'Run the DevDigest Structured Reviewer. With `prId`, reviews that PR via the engine. ' +
      'With `mode=working|push`, reviews the LOCAL diff (pre-push) and returns the raw diff for the ' +
      'agent to reason over (the engine review is PR-scoped; local diff review is surfaced here).',
    inputSchema: {
      prId: z.string().optional(),
      mode: z.enum(['working', 'push']).optional(),
      base: z.string().optional().describe('Base ref for push mode (default origin/HEAD)'),
      cwd: z.string().optional(),
    },
  },
  async ({ prId, mode, base, cwd }) => {
    try {
      if (prId) return text(await client.runReview(prId, { all: true }));
      const diff = mode === 'push' ? pushDiff(base, cwd) : workingDiff(cwd);
      if (!diff.trim()) return text('No changes in the working tree to review.');
      return text(diff);
    } catch (e) {
      return errText(e);
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdio servers log to stderr only (stdout is the protocol channel)
  process.stderr.write('devdigest-mcp: connected over stdio\n');
}

main().catch((err) => {
  process.stderr.write(`devdigest-mcp fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
