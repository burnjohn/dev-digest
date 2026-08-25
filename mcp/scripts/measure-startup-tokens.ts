#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { getEncoding } from 'js-tiktoken';
import { z } from 'zod';
import { buildServer } from '../src/server.js';
import type { ApiPort } from '../src/ports.js';
import type { McpConfig } from '../src/config.js';

/**
 * A tool OUTSIDE the rings (§5.12, the exact analogue of `server/src/db/seed.ts`)
 * — nothing under `mcp/src/**` may import this file, and this file is not
 * bound by `mcp/test/rings.test.ts` (its scan root is `mcp/src/`, not
 * `mcp/scripts/`). It may therefore do things a ring file may not: build a
 * throwaway `McpConfig` object literal by hand (never `loadConfig()`, which
 * reads `process.env`) and reach into `McpServer`'s own bookkeeping.
 *
 * What "measuring the startup token cost" means (§5.10, REQ-27): what Claude
 * Code loads at session start with tool search ON is the server name, each
 * tool's NAME, and the server `instructions` string — schemas and
 * descriptions are deferred until the model searches for a tool. This script
 * prints that number (`deferred_startup_tokens`) plus two things to compare
 * it against: `full_schema_tokens`, the counterfactual if this server ever
 * set `alwaysLoad` (REQ-8 forbids that, so this number should stay a ceiling
 * nobody hits by design, not a target), and each tool description's byte
 * count against REQ-7's 2048-byte budget.
 *
 * No transport, no network, no API (server/INSIGHTS.md, 2026-08-21: a lane
 * that can reach a live model or a live API stays green while quietly
 * billing or flaking — this script must not be that lane). `buildServer(deps)`
 * is transport-free by construction (`server.ts`'s own doc comment), and the
 * `ApiPort` handed to it here throws if any method is ever called — the
 * measurement only registers tools, it never calls one.
 */

/** Same budget `tools/_register.ts` enforces at registration time (REQ-7). */
const MAX_DESCRIPTION_BYTES = 2048;

function unreachable(method: string): () => Promise<never> {
  return async () => {
    throw new Error(
      `measure-startup-tokens: ApiPort.${method}() was called. This script only builds and ` +
        'registers the server — it must never make a network call.',
    );
  };
}

/** A fake `ApiPort` that satisfies the type and throws if `buildServer` or a
 *  tool handler ever actually calls it — which they should not, since this
 *  script never invokes `tools/call`. */
function createOfflineApi(): ApiPort {
  return {
    lookupPull: unreachable('lookupPull'),
    listAgents: unreachable('listAgents'),
    listRepos: unreachable('listRepos'),
    listActiveRuns: unreachable('listActiveRuns'),
    startReview: unreachable('startReview'),
    listRuns: unreachable('listRuns'),
    listReviews: unreachable('listReviews'),
    listConventions: unreachable('listConventions'),
    getBlastRadius: unreachable('getBlastRadius'),
  };
}

/** A plain object literal — never `loadConfig()`, which is the one function
 *  in the package allowed to read `process.env` (§5.12.2 rule 1). The values
 *  match `config.ts`'s own defaults so the measured `instructions` string is
 *  the one every real session actually loads. */
function offlineConfig(): McpConfig {
  return {
    apiBaseUrl: 'http://localhost:3001',
    webUiUrl: 'http://localhost:3000',
    runBudgetMs: 90_000,
    allowRemote: false,
  };
}

/* ------------------------------------------------------------------------ */
/* Reading the in-process registry                                          */
/* ------------------------------------------------------------------------ */

/**
 * `McpServer`/`Server` (the MCP TypeScript SDK) keep the registered tools and
 * the `instructions` string on TypeScript-`private` fields with no public
 * getter (verified against `@modelcontextprotocol/sdk@1.30.0`'s own `.d.ts`
 * — there is no `listTools()`/`getInstructions()` escape hatch on the
 * server side, only on `Client`). At RUNTIME these are ordinary properties
 * (`private` is a compile-time check only), so a narrow, locally-declared
 * interface plus a cast through `unknown` reads them without a real
 * transport — the same "cast instead of a live round trip" trade this
 * package's own tests make for other private state
 * (`onion-architecture` skill, §5 Tests: "build a fake container ... and
 * write a private field"). If a future SDK version renames these fields,
 * this script breaks loudly (a `TypeError` at `Object.entries`), not
 * silently.
 */
interface RegisteredToolInternal {
  title?: string;
  description?: string;
  inputSchema?: z.ZodObject<z.ZodRawShape>;
  outputSchema?: z.ZodObject<z.ZodRawShape>;
}

interface McpServerRegistry {
  _registeredTools: Record<string, RegisteredToolInternal>;
}

interface UnderlyingServerInstructions {
  _instructions?: string;
}

interface ToolIntrospection {
  name: string;
  title: string;
  description: string;
  inputSchema?: z.ZodObject<z.ZodRawShape>;
  outputSchema?: z.ZodObject<z.ZodRawShape>;
}

type ServerLike = ReturnType<typeof buildServer>;

function introspect(server: ServerLike): { instructions: string; tools: ToolIntrospection[] } {
  const registry = (server as unknown as McpServerRegistry)._registeredTools;
  const instructions = (server.server as unknown as UnderlyingServerInstructions)._instructions ?? '';

  const tools = Object.entries(registry).map(([name, tool]) => ({
    name,
    title: tool.title ?? '',
    description: tool.description ?? '',
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
  }));

  return { instructions, tools };
}

/* ------------------------------------------------------------------------ */
/* The `alwaysLoad` counterfactual — a schema descriptor, not the SDK's own */
/* wire JSON Schema (that conversion lives in an unexported SDK internal)   */
/* ------------------------------------------------------------------------ */

type SchemaDescriptor = Record<string, unknown>;

function withDescription(schema: z.ZodTypeAny, base: SchemaDescriptor): SchemaDescriptor {
  return schema.description ? { ...base, description: schema.description } : base;
}

/** Walks a zod schema using only PUBLIC getters (`.shape`, `.element`,
 *  `.options`, `.value`, `.unwrap()`, `.removeDefault()`) — never `._def`,
 *  matching `tools/_register.ts`'s own `isNestedZodType` convention "so this
 *  stays stable across zod patch versions". Not a JSON Schema converter: a
 *  compact, self-consistent descriptor good enough to size the payload an
 *  `alwaysLoad` tool definition would actually carry. */
function describeZodType(schema: z.ZodTypeAny): SchemaDescriptor {
  if (schema instanceof z.ZodOptional) return describeZodType(schema.unwrap());
  if (schema instanceof z.ZodNullable) return { ...describeZodType(schema.unwrap()), nullable: true };
  if (schema instanceof z.ZodDefault) return describeZodType(schema.removeDefault());
  if (schema instanceof z.ZodString) return withDescription(schema, { type: 'string' });
  if (schema instanceof z.ZodNumber) return withDescription(schema, { type: 'number' });
  if (schema instanceof z.ZodBoolean) return withDescription(schema, { type: 'boolean' });
  if (schema instanceof z.ZodLiteral) return withDescription(schema, { type: 'literal', value: schema.value });
  if (schema instanceof z.ZodEnum) return withDescription(schema, { type: 'enum', values: schema.options });
  if (schema instanceof z.ZodArray) {
    return withDescription(schema, { type: 'array', items: describeZodType(schema.element) });
  }
  if (schema instanceof z.ZodUnion) {
    const options = schema.options as z.ZodTypeAny[];
    return withDescription(schema, { type: 'union', options: options.map((o) => describeZodType(o)) });
  }
  if (schema instanceof z.ZodObject) {
    const properties: Record<string, SchemaDescriptor> = {};
    for (const [key, value] of Object.entries(schema.shape)) {
      properties[key] = describeZodType(value as z.ZodTypeAny);
    }
    return withDescription(schema, { type: 'object', properties });
  }
  return { type: schema.constructor.name };
}

function describeObjectSchema(schema: z.ZodObject<z.ZodRawShape> | undefined): SchemaDescriptor {
  if (!schema) return {};
  const properties: Record<string, SchemaDescriptor> = {};
  for (const [key, value] of Object.entries(schema.shape)) {
    properties[key] = describeZodType(value as z.ZodTypeAny);
  }
  return properties;
}

function fullToolPayload(tool: ToolIntrospection): SchemaDescriptor {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: describeObjectSchema(tool.inputSchema),
    outputSchema: describeObjectSchema(tool.outputSchema),
  };
}

/* ------------------------------------------------------------------------ */
/* Token counting                                                            */
/* ------------------------------------------------------------------------ */

/** `cl100k_base` — an OpenAI tokenizer, not Claude's. It is a reproducible,
 *  version-pinned proxy for tracking drift in what this server loads at
 *  session start, never an exact Anthropic token count (§5.10, `mcp/README.md`
 *  §7 states this in full — do not compare this number against a Claude
 *  context budget). Already a proven dependency in this repo:
 *  `server/src/adapters/tokenizer/index.ts` uses the same encoding — lazily
 *  loaded and cached module-wide here for the same reason that adapter
 *  caches it per-instance: loading the BPE ranks is the heavy part, and
 *  `measureStartupCost()` runs more than once per process when
 *  `test/startup-cost.test.ts` calls it from several `it()` blocks. */
let cachedEncoding: ReturnType<typeof getEncoding> | undefined;

function countTokens(text: string): number {
  cachedEncoding ??= getEncoding('cl100k_base');
  return cachedEncoding.encode(text).length;
}

/* ------------------------------------------------------------------------ */
/* The measurement itself — exported so `test/startup-cost.test.ts` can pin */
/* `deferredStartupTokens` without re-running this file as a CLI (the       */
/* `main()` guard below only fires when this file is the process entry).    */
/* ------------------------------------------------------------------------ */

export interface StartupCost {
  instructions: string;
  tools: ToolIntrospection[];
  deferredStartupTokens: number;
  fullSchemaTokens: number;
}

export function measureStartupCost(): StartupCost {
  const server = buildServer({ config: offlineConfig(), api: createOfflineApi() });
  const { instructions, tools } = introspect(server);

  if (tools.length === 0) {
    throw new Error(
      'measure-startup-tokens: buildServer(deps) registered zero tools — the private-field ' +
        'introspection in this script no longer matches the SDK version in mcp/package.json.',
    );
  }

  // What Claude Code actually loads at session start with tool search ON
  // (§5.10): the server name is fixed and tiny, so this counts `instructions`
  // plus every tool's bare NAME — never a description or a schema.
  const toolNamesText = tools.map((t) => t.name).join('\n');
  const deferredStartupTokens = countTokens(instructions) + countTokens(toolNamesText);

  // The counterfactual if this server ever set `alwaysLoad` (REQ-8 forbids
  // it) — instructions plus every tool's full definition: name, title,
  // description, and both schemas.
  const fullPayload = JSON.stringify(tools.map((t) => fullToolPayload(t)));
  const fullSchemaTokens = countTokens(instructions) + countTokens(fullPayload);

  return { instructions, tools, deferredStartupTokens, fullSchemaTokens };
}

/* ------------------------------------------------------------------------ */
/* main — CLI entry, `npm run measure`                                      */
/* ------------------------------------------------------------------------ */

function main(): void {
  const { tools, deferredStartupTokens, fullSchemaTokens } = measureStartupCost();
  const today = new Date().toISOString().slice(0, 10);

  console.log(`deferred_startup_tokens = ${deferredStartupTokens} (measured ${today}, cd mcp && npm run measure)`);
  console.log(`full_schema_tokens = ${fullSchemaTokens} (measured ${today}, cd mcp && npm run measure)`);
  console.log('');
  console.log(`Per-tool description size vs the ${MAX_DESCRIPTION_BYTES}-byte budget (REQ-7):`);
  for (const tool of tools) {
    const bytes = Buffer.byteLength(tool.description, 'utf8');
    const pct = ((bytes / MAX_DESCRIPTION_BYTES) * 100).toFixed(0);
    console.log(`  ${tool.name}: ${bytes} bytes (${pct}% of budget)`);
  }
  console.log('');
  console.log(
    'cl100k_base is an OpenAI tokenizer, not Claude\'s — these numbers are a reproducible drift ' +
      'proxy, not an Anthropic token count. Do not compare them against a Claude context budget.',
  );
}

// Only run as a CLI when this file is the process entry point (`npm run
// measure`) — not when `test/startup-cost.test.ts` imports
// `measureStartupCost` to pin the number under a ceiling. `pathToFileURL` (not
// a hand-rolled string join) is what keeps this correct on Windows, where
// `process.argv[1]` is drive-letter-and-backslash form
// (`C:\...\measure-startup-tokens.ts`) while `import.meta.url` is always a
// `file:///C:/...` URL.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}
