import { z } from 'zod';
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

/** JSON-pointer prefixes that `zod-to-json-schema` (via `zodResponseFormat`)
 *  extracts reused sub-schemas under (`$refStrategy: 'extract-to-root'`). */
const REF_CONTAINER_KEYS = ['$defs', 'definitions'] as const;

/**
 * Resolve a JSON-pointer `$ref` of the form `#/$defs/<name>` or
 * `#/definitions/<name>` against the root schema. Returns `undefined` if the
 * pointer doesn't resolve to a known container/name (left as-is by the caller).
 */
function resolveRef(root: Record<string, unknown>, ref: string): unknown {
  for (const key of REF_CONTAINER_KEYS) {
    const prefix = `#/${key}/`;
    if (ref.startsWith(prefix)) {
      const defs = root[key];
      if (defs && typeof defs === 'object') {
        const name = ref.slice(prefix.length);
        return (defs as Record<string, unknown>)[name];
      }
    }
  }
  return undefined;
}

/**
 * Recursively inline every `$ref` node found anywhere in `node` by replacing it
 * with a deep clone of its resolved target (looked up in `root`'s `$defs` /
 * `definitions`). Gemini (via OpenRouter) requires a fully self-contained JSON
 * Schema — it rejects `$ref`s that point at a sibling `$defs`/`definitions`
 * container, unlike OpenAI/Anthropic/DeepSeek/Mistral which resolve them.
 *
 * `visiting` tracks refs currently being inlined on the current recursion path
 * — if a genuine cycle is hit, that one `$ref` is left unresolved (returned
 * as-is) rather than recursing forever. The Review schema is acyclic; this is
 * purely defensive.
 */
function dereference(node: unknown, root: Record<string, unknown>, visiting: Set<string>): unknown {
  if (Array.isArray(node)) {
    return node.map((item) => dereference(item, root, visiting));
  }
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const ref = obj['$ref'];
    if (typeof ref === 'string') {
      if (visiting.has(ref)) return node; // cycle guard — leave this one $ref in place
      const target = resolveRef(root, ref);
      if (target === undefined) return node; // unresolvable — leave as-is
      const nextVisiting = new Set(visiting).add(ref);
      return dereference(target, root, nextVisiting);
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      out[key] = dereference(value, root, visiting);
    }
    return out;
  }
  return node;
}

/**
 * Fully dereference a JSON Schema produced by `zodResponseFormat`: inline every
 * internal `$ref` (in-place deep clone of the referenced sub-schema) and drop
 * the top-level `$defs`/`definitions` container. Result has ZERO `$ref` and
 * ZERO `$defs`/`definitions` anywhere — required for Gemini (via OpenRouter)
 * structured output, which rejects schemas with unresolved internal refs.
 * OpenAI/Anthropic strict mode accepts a self-contained (ref-free) schema too,
 * so this is safe for every provider.
 */
function fullyDereference(schema: Record<string, unknown>): Record<string, unknown> {
  const inlined = dereference(schema, schema, new Set<string>()) as Record<string, unknown>;
  const out = { ...inlined };
  for (const key of REF_CONTAINER_KEYS) delete out[key];
  return out;
}

export function toJsonSchema<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, name: string): JsonSchema {
  const rf = zodResponseFormat(schema as z.ZodTypeAny, name);
  const raw = rf.json_schema.schema as Record<string, unknown>;
  return { schema: fullyDereference(raw), name };
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

export function parseWithRepair<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw: string): ParseResult<T> {
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
