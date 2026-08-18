import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  ConventionDedup,
  ConventionExtraction,
  ConventionFileSelection,
} from '../src/modules/conventions/service.js';

/**
 * Every structured call this server makes goes out with `strict: true`
 * (`adapters/llm/openai.ts`), and OpenAI's strict json_schema mode has one rule Zod
 * does not: **every field must be required**. A field may be `.nullable()`, and it
 * may be `.nullish()` (nullable AND optional, which is why the extraction schema's
 * many `.nullish()` fields are fine) — but `.optional()` or `.default()` WITHOUT
 * `.nullable()` is rejected by the API.
 *
 * The failure mode is nasty: `zodResponseFormat` still emits the field in
 * `required`, so the converted JSON schema looks legal and only a console warning
 * marks it. The API rejects the request at call time, in production only. That is
 * exactly how the conventions dedup pass came to silently do nothing on every scan.
 *
 * So this checks the ZOD side, where the rule actually lives.
 */

/** Unwrap the wrappers that don't change a field's own optional/nullable status. */
function inner(schema: z.ZodTypeAny): z.ZodTypeAny | null {
  const def = schema._def as Record<string, unknown>;
  const next = (def.innerType ?? def.type ?? def.schema) as z.ZodTypeAny | undefined;
  return next && typeof (next as z.ZodTypeAny)._def === 'object' ? next : null;
}

/** The union arms of a (discriminated) union, or `[]`. */
function arms(schema: z.ZodTypeAny): z.ZodTypeAny[] {
  const options = (schema._def as Record<string, unknown>).options;
  if (Array.isArray(options)) return options as z.ZodTypeAny[];
  if (options instanceof Map) return [...options.values()] as z.ZodTypeAny[];
  return [];
}

/**
 * Path of the first field that is optional but not nullable, or `null`.
 * `seen` guards against a schema that references itself.
 */
function firstOptionalWithoutNullable(
  schema: z.ZodTypeAny,
  path = '$',
  seen = new Set<z.ZodTypeAny>(),
): string | null {
  if (seen.has(schema)) return null;
  seen.add(schema);

  if (schema instanceof z.ZodObject) {
    for (const [key, raw] of Object.entries(schema.shape as Record<string, z.ZodTypeAny>)) {
      const field = raw;
      if (field.isOptional() && !field.isNullable()) return `${path}.${key}`;
      const hit = firstOptionalWithoutNullable(field, `${path}.${key}`, seen);
      if (hit) return hit;
    }
    return null;
  }

  for (const arm of arms(schema)) {
    const hit = firstOptionalWithoutNullable(arm, `${path}|`, seen);
    if (hit) return hit;
  }

  const next = inner(schema);
  return next ? firstOptionalWithoutNullable(next, `${path}[]`, seen) : null;
}

/** The schemas actually sent with `strict: true`, by the name the adapter uses. */
const SENT_WITH_STRICT: [string, z.ZodTypeAny][] = [
  ['ConventionFileSelection', ConventionFileSelection],
  ['ConventionExtraction', ConventionExtraction],
  ['ConventionDedup', ConventionDedup],
];

describe('structured schemas are OpenAI strict-mode compatible', () => {
  for (const [name, schema] of SENT_WITH_STRICT) {
    it(`${name} has no optional-without-nullable field`, () => {
      expect(firstOptionalWithoutNullable(schema)).toBeNull();
    });
  }

  it('the checker catches `.default()` and `.optional()`, and allows `.nullish()`', () => {
    // Guard the guard. `.default([])` is the exact shape that broke the dedup pass;
    // if this stops being a violation the suite above proves nothing.
    expect(firstOptionalWithoutNullable(z.object({ b: z.array(z.number()).default([]) }))).toBe('$.b');
    expect(firstOptionalWithoutNullable(z.object({ b: z.string().optional() }))).toBe('$.b');
    expect(firstOptionalWithoutNullable(z.object({ b: z.string().nullish() }))).toBeNull();
    expect(firstOptionalWithoutNullable(z.object({ b: z.string().nullable() }))).toBeNull();
  });

  it('reaches fields nested inside arrays and unions', () => {
    const nested = z.object({ items: z.array(z.object({ bad: z.string().default('x') })) });
    expect(firstOptionalWithoutNullable(nested)).toBe('$.items[].bad');
  });
});
