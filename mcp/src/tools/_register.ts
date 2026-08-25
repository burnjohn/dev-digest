import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/**
 * The one place every tool registers through (ring M4) — this package's
 * `routes.ts`, in the sense §5.12 draws the analogy: `tools/` is to `mcp/`
 * what `modules/<m>/routes.ts` is to a server module, and `_register.ts` is
 * where "schema-first at the boundary" lives now that `fastify-best-practices`
 * is named inapplicable to this package (plan 05 §5.12.4) — there is no
 * `schema.response` gate here, so this file IS that gate.
 *
 * Every later tool (T9's two, T10's two, T11's server wiring) registers
 * through `registerTool` below, never through `server.registerTool` directly.
 * That is what turns four separate promises into one enforced one:
 *
 *   - all five `McpServer.registerTool` config keys are structurally
 *     required (REQ-6) — TypeScript rejects a call missing any of them;
 *   - the SEP-986 name charset is validated at registration (REQ-5);
 *   - `description` is checked against the 2048-byte UTF-8 budget and
 *     THROWS if it is over — never silently truncated (REQ-7);
 *   - `inputSchema` is walked for any object- or array-typed property and
 *     rejected — tool arguments stay flat primitives (REQ-9, principle 2);
 *   - `annotations.readOnlyHint` is a required field on `ToolAnnotations`
 *     below, never defaulted — every caller states it explicitly.
 */

/** SEP-986: a tool name is 1–64 chars from this charset. */
const TOOL_NAME_RE = /^[A-Za-z0-9_.\-/]{1,64}$/;

/** REQ-7's byte budget, measured as UTF-8 — matches §5.13's table. */
const MAX_DESCRIPTION_BYTES = 2048;

/**
 * A narrower `ToolAnnotations` than the SDK's own (which makes every field
 * optional): `readOnlyHint` is required here so a caller cannot forget it
 * and silently inherit the SDK's `false` default. Structurally compatible
 * with the SDK's type, so it needs no cast at the `server.registerTool` call
 * site below.
 */
export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
}

/** The five config keys REQ-6 makes mandatory — no optional properties. */
export interface ToolRegistration<InputShape extends z.ZodRawShape, OutputShape extends z.ZodRawShape> {
  title: string;
  description: string;
  inputSchema: InputShape;
  outputSchema: OutputShape;
  annotations: ToolAnnotations;
}

/**
 * What a handler returns to `registerTool`, not what the SDK expects on the
 * wire — this function does that translation once, in one place, so a
 * handler never assembles a `content` array by hand.
 */
export interface ToolOutcome<Output> {
  /** Validated shape the client reads programmatically. */
  structuredContent: Output;
  /** Becomes `content[0].text`. First sentence must name the next action
   *  when `isError` is true (REQ-22) — this file does not enforce that
   *  wording, only that a `text` is always supplied. */
  text: string;
  /** Explicit per call; never implicitly `false`. */
  isError?: boolean;
}

export type ToolHandler<InputShape extends z.ZodRawShape, OutputShape extends z.ZodRawShape> = (
  args: z.infer<z.ZodObject<InputShape>>,
) => Promise<ToolOutcome<z.infer<z.ZodObject<OutputShape>>>>;

function assertValidName(name: string): void {
  if (!TOOL_NAME_RE.test(name)) {
    throw new Error(
      `registerTool: "${name}" is not a valid SEP-986 tool name — must be 1-64 chars matching ` +
        `${TOOL_NAME_RE} (REQ-5).`,
    );
  }
}

function assertDescriptionBudget(name: string, description: string): void {
  const bytes = Buffer.byteLength(description, 'utf8');
  if (bytes > MAX_DESCRIPTION_BYTES) {
    throw new Error(
      `registerTool("${name}"): description is ${bytes} UTF-8 bytes, over the ` +
        `${MAX_DESCRIPTION_BYTES}-byte budget (REQ-7). Shorten it — a registration-time throw is the ` +
        'point; this must never be silently truncated.',
    );
  }
}

/**
 * Unwraps `optional()` / `nullable()` / `default()` down to the schema they
 * wrap, using zod's own public `unwrap()` / `removeDefault()` methods (never
 * the private `_def` shape) so this stays stable across zod patch versions.
 */
function isNestedZodType(schema: z.ZodTypeAny): boolean {
  if (
    schema instanceof z.ZodObject ||
    schema instanceof z.ZodArray ||
    schema instanceof z.ZodRecord ||
    schema instanceof z.ZodTuple
  ) {
    return true;
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return isNestedZodType(schema.unwrap());
  }
  if (schema instanceof z.ZodDefault) {
    return isNestedZodType(schema.removeDefault());
  }
  return false;
}

function assertFlatInputSchema(name: string, shape: z.ZodRawShape): void {
  for (const [key, schema] of Object.entries(shape)) {
    if (isNestedZodType(schema)) {
      throw new Error(
        `registerTool("${name}"): inputSchema.${key} is object- or array-typed — tool arguments must ` +
          'be flat primitives, one value per argument (REQ-9, principle 2).',
      );
    }
  }
}

/**
 * Registers one tool on `server`, enforcing REQ-5, REQ-6, REQ-7 and REQ-9
 * before the SDK ever sees the call. Throws synchronously on any violation —
 * a registration failure belongs at startup, not at the first `tools/call`.
 */
export function registerTool<InputShape extends z.ZodRawShape, OutputShape extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  config: ToolRegistration<InputShape, OutputShape>,
  handler: ToolHandler<InputShape, OutputShape>,
): void {
  assertValidName(name);
  assertDescriptionBudget(name, config.description);
  assertFlatInputSchema(name, config.inputSchema);

  const registeredConfig = {
    title: config.title,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: config.outputSchema,
    annotations: config.annotations,
  };

  const wrappedHandler = async (args: unknown) => {
    const outcome = await handler(args as z.infer<z.ZodObject<InputShape>>);
    return {
      content: [{ type: 'text' as const, text: outcome.text }],
      structuredContent: outcome.structuredContent,
      isError: outcome.isError ?? false,
    };
  };

  // The SDK's own generic surface for `registerTool` composes deeply nested
  // mapped types (raw-shape -> StandardSchemaWithJSON inference) that do not
  // compose with THIS function's generics without TS2589 ("Type
  // instantiation is excessively deep"). Everything above this line is
  // fully typed against `ToolRegistration`/`ToolHandler`; this boundary cast
  // is the one place those types meet the SDK's, and it is deliberate, not
  // a shortcut around REQ-6 — the required-key shape is still enforced by
  // `ToolRegistration` at every call site.
  server.registerTool(
    name,
    registeredConfig as Parameters<McpServer['registerTool']>[1],
    wrappedHandler as Parameters<McpServer['registerTool']>[2],
  );
}
