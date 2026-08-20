import type { z } from 'zod';
import { zodResponseFormat } from 'openai/helpers/zod';

/**
 * structured-output helpers shared by both LLM providers.
 *
 * - `toJsonSchema` converts a Zod schema to a JSON Schema (draft-07, strict
 *   object) by reusing OpenAI's bundled converter — used for OpenAI's
 *   `response_format: json_schema` AND Anthropic forced tool-use `input_schema`.
 * - `parseWithRepair` validates raw model text against the Zod schema and, on
 *   failure, returns a reprompt instruction so the caller can retry-on-error.
 */

export interface JsonSchema {
  schema: Record<string, unknown>;
  name: string;
}

const OMITTED_PORTABLE_KEYS = new Set(['$defs', 'definitions', 'minimum', 'maximum']);

function decodePointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

function resolveLocalReference(root: Record<string, unknown>, ref: string): unknown {
  if (!ref.startsWith('#/')) throw new Error(`Only local JSON Schema references are supported: ${ref}`);
  let current: unknown = root;
  for (const rawSegment of ref.slice(2).split('/')) {
    const segment = decodePointerSegment(rawSegment);
    if (!current || typeof current !== 'object' || Array.isArray(current) || !(segment in current)) {
      throw new Error(`JSON Schema reference does not resolve: ${ref}`);
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function normalizeSchemaNode(
  node: unknown,
  root: Record<string, unknown>,
  resolving: ReadonlySet<string>,
): unknown {
  if (Array.isArray(node)) return node.map((item) => normalizeSchemaNode(item, root, resolving));
  if (!node || typeof node !== 'object') return node;

  const record = node as Record<string, unknown>;
  const ref = record.$ref;
  if (typeof ref === 'string') {
    if (resolving.has(ref)) throw new Error(`Cyclic JSON Schema reference: ${ref}`);
    const nextResolving = new Set(resolving);
    nextResolving.add(ref);
    const resolved = normalizeSchemaNode(resolveLocalReference(root, ref), root, nextResolving);
    const siblings = Object.fromEntries(Object.entries(record).filter(([key]) => key !== '$ref'));
    if (Object.keys(siblings).length === 0) return resolved;
    if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
      throw new Error(`JSON Schema reference does not resolve to an object: ${ref}`);
    }
    return {
      ...(resolved as Record<string, unknown>),
      ...(normalizeSchemaNode(siblings, root, resolving) as Record<string, unknown>),
    };
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (OMITTED_PORTABLE_KEYS.has(key)) continue;
    normalized[key] = normalizeSchemaNode(value, root, resolving);
  }
  return normalized;
}

/**
 * Normalize the OpenAI-generated JSON Schema for strict structured-output
 * providers routed through OpenRouter. Anthropic-compatible endpoints reject
 * numeric bounds and some endpoints fail to resolve local definitions, so refs
 * are inlined and those transport-only constraints are removed. The original
 * Zod schema remains authoritative in parseWithRepair.
 */
export function portableJsonSchema(root: Record<string, unknown>): Record<string, unknown> {
  return normalizeSchemaNode(root, root, new Set()) as Record<string, unknown>;
}

export function toJsonSchema<T>(schema: z.ZodType<T>, name: string): JsonSchema {
  const rf = zodResponseFormat(schema as z.ZodTypeAny, name);
  return {
    schema: portableJsonSchema(rf.json_schema.schema as Record<string, unknown>),
    name,
  };
}

/** Best-effort extraction of a JSON object/array from a model's text output. */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  // strip ```json fences
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  // find first balanced { … } or [ … ]
  const firstObj = trimmed.indexOf('{');
  const firstArr = trimmed.indexOf('[');
  const start =
    firstObj === -1 ? firstArr : firstArr === -1 ? firstObj : Math.min(firstObj, firstArr);
  if (start === -1) return trimmed;
  const open = trimmed[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return trimmed.slice(start);
}

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; repromptMessage: string };

export function parseWithRepair<T>(schema: z.ZodType<T>, raw: string): ParseResult<T> {
  let parsedJson: unknown;
  try {
    // Strict json_schema mode returns pure JSON — parse it directly. Only fall
    // back to fence/brace extraction if that fails, because extractJson can be
    // fooled by ``` fences or `{` braces that appear INSIDE JSON string values
    // (e.g. markdown code blocks in an onboarding `body`).
    try {
      parsedJson = JSON.parse(raw.trim());
    } catch {
      parsedJson = JSON.parse(extractJson(raw));
    }
  } catch (e) {
    const msg = `Output was not valid JSON: ${(e as Error).message}`;
    return {
      ok: false,
      error: msg,
      repromptMessage: `${msg}\nReturn ONLY a single valid JSON object matching the schema, no prose.`,
    };
  }
  const result = schema.safeParse(parsedJson);
  if (result.success) return { ok: true, data: result.data };
  const issues = result.error.issues
    .map((i) => `- ${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('\n');
  return {
    ok: false,
    error: issues,
    repromptMessage: `Your JSON did not match the required schema. Fix these and return ONLY valid JSON:\n${issues}`,
  };
}
