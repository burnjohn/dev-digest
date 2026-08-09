import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Review } from '@devdigest/shared';
import {
  parseWithRepair,
  portableJsonSchema,
  toJsonSchema,
} from '../src/llm/structured.js';

function keysNamed(value: unknown, wanted: string, found: unknown[] = []): unknown[] {
  if (Array.isArray(value)) {
    for (const item of value) keysNamed(item, wanted, found);
    return found;
  }
  if (!value || typeof value !== 'object') return found;
  for (const [key, child] of Object.entries(value)) {
    if (key === wanted) found.push(child);
    keysNamed(child, wanted, found);
  }
  return found;
}

function reviewWithConfidence(confidence: number): unknown {
  return {
    verdict: 'comment',
    summary: 'One issue',
    score: 80,
    findings: [
      {
        id: 'f1',
        severity: 'WARNING',
        category: 'bug',
        title: 'Wrong branch',
        file: 'src/a.ts',
        start_line: 10,
        end_line: 10,
        rationale: 'The condition is inverted.',
        confidence,
        kind: 'finding',
      },
    ],
  };
}

describe('portable structured output schema', () => {
  it('inlines local references and removes provider-unsupported bounds from Review', () => {
    const schema = toJsonSchema(Review, 'Review').schema;

    expect(keysNamed(schema, '$ref')).toEqual([]);
    expect(keysNamed(schema, '$defs')).toEqual([]);
    expect(keysNamed(schema, 'definitions')).toEqual([]);
    expect(keysNamed(schema, 'minimum')).toEqual([]);
    expect(keysNamed(schema, 'maximum')).toEqual([]);
  });

  it('inlines each repeated local reference without sharing mutable objects', () => {
    const raw = {
      type: 'object',
      properties: {
        first: { $ref: '#/$defs/Bounded' },
        second: { $ref: '#/$defs/Bounded' },
      },
      $defs: {
        Bounded: { type: 'integer', minimum: 0, maximum: 100 },
      },
    };

    const normalized = portableJsonSchema(raw);
    const properties = normalized.properties as Record<string, Record<string, unknown>>;

    expect(properties.first).toEqual({ type: 'integer' });
    expect(properties.second).toEqual({ type: 'integer' });
    expect(properties.first).not.toBe(properties.second);
    expect(normalized).not.toHaveProperty('$defs');
  });

  it('keeps the original Zod schema authoritative after transport normalization', () => {
    const parsed = parseWithRepair(Review, JSON.stringify(reviewWithConfidence(2)));

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain('confidence');
  });

  it('still handles schemas without local references', () => {
    const schema = z.object({ ok: z.boolean() });
    expect(toJsonSchema(schema, 'Probe').schema).toMatchObject({ type: 'object' });
  });
});
