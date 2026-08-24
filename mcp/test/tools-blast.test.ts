import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTool, type ToolRegistration } from '../src/tools/_register.js';
import { registerGetBlastRadius } from '../src/tools/get-blast-radius.js';
import { GetBlastRadiusOutput } from '../src/schemas/blast.js';

/**
 * T8's own tests — the registration convention (`_register.ts`) and its
 * first demonstration (`get_blast_radius`). A fake `McpServer` is used
 * throughout: it captures exactly what `registerTool` passed to the real
 * `server.registerTool`, which is what lets these tests assert on config
 * shape and re-invoke the wrapped handler without a live transport.
 */

interface CapturedTool {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
    annotations?: unknown;
  };
  handler: (args: unknown) => Promise<{
    content: { type: string; text: string }[];
    structuredContent: unknown;
    isError: boolean;
  }>;
}

function createFakeServer(): { server: McpServer; registered: CapturedTool[] } {
  const registered: CapturedTool[] = [];
  const fake = {
    registerTool: vi.fn((name: string, config: CapturedTool['config'], handler: CapturedTool['handler']) => {
      registered.push({ name, config, handler });
    }),
  };
  return { server: fake as unknown as McpServer, registered };
}

const VALID_CONFIG: ToolRegistration<{ repo: z.ZodString }, { ok: z.ZodBoolean }> = {
  title: 'Flat',
  description: 'short',
  inputSchema: { repo: z.string() },
  outputSchema: { ok: z.boolean() },
  annotations: { readOnlyHint: true },
};

async function noopHandler() {
  return { structuredContent: { ok: true }, text: 'ok' };
}

describe('registerTool — the structural gate every tool registers through (REQ-5, REQ-6, REQ-7, REQ-9)', () => {
  it('registers a valid flat tool, passing all five config keys through to server.registerTool', () => {
    const { server, registered } = createFakeServer();

    registerTool(server, 'flat_tool', VALID_CONFIG, noopHandler);

    expect(registered).toHaveLength(1);
    const tool = registered[0]!;
    expect(tool.name).toBe('flat_tool');
    expect(tool.config.title).toBe('Flat');
    expect(tool.config.description).toBe('short');
    expect(tool.config.inputSchema).toBeDefined();
    expect(tool.config.outputSchema).toBeDefined();
    expect(tool.config.annotations).toEqual({ readOnlyHint: true });
  });

  it('rejects a name outside the SEP-986 charset (REQ-5)', () => {
    const { server } = createFakeServer();
    expect(() => registerTool(server, 'bad name!', VALID_CONFIG, noopHandler)).toThrow(/SEP-986/);
  });

  it('throws at registration when description exceeds the 2048-byte UTF-8 budget, never truncates (REQ-7)', () => {
    const { server, registered } = createFakeServer();
    const overLong = 'x'.repeat(2049);

    expect(() =>
      registerTool(server, 'oversized_tool', { ...VALID_CONFIG, description: overLong }, noopHandler),
    ).toThrow(/2048/);
    // The throw happens before server.registerTool is ever called — nothing
    // truncated slips through.
    expect(registered).toHaveLength(0);
  });

  it('rejects an object-typed input property (REQ-9)', () => {
    const { server } = createFakeServer();
    expect(() =>
      registerTool(
        server,
        'nested_object_tool',
        { ...VALID_CONFIG, inputSchema: { filters: z.object({ severity: z.string() }) } },
        noopHandler,
      ),
    ).toThrow(/object- or array-typed/);
  });

  it('rejects an array-typed input property (REQ-9)', () => {
    const { server } = createFakeServer();
    expect(() =>
      registerTool(
        server,
        'nested_array_tool',
        { ...VALID_CONFIG, inputSchema: { tags: z.array(z.string()) } },
        noopHandler,
      ),
    ).toThrow(/object- or array-typed/);
  });

  it('accepts an optional flat primitive — optionality alone is not nesting', () => {
    const { server, registered } = createFakeServer();
    registerTool(server, 'optional_flat_tool', { ...VALID_CONFIG, inputSchema: { repo: z.string().optional() } }, noopHandler);
    expect(registered).toHaveLength(1);
  });
});

describe('registerTool — type-level: all five config keys are structurally required (REQ-6)', () => {
  it('is proven by `npm run typecheck` failing without these @ts-expect-error lines', () => {
    // @ts-expect-error — omitting `outputSchema` must be a compile error.
    const missingOutputSchema: ToolRegistration<{ repo: z.ZodString }, { ok: z.ZodBoolean }> = {
      title: 'Missing',
      description: 'short',
      inputSchema: { repo: z.string() },
      annotations: { readOnlyHint: true },
    };
    void missingOutputSchema;

    // @ts-expect-error — omitting `annotations` must be a compile error.
    const missingAnnotations: ToolRegistration<{ repo: z.ZodString }, { ok: z.ZodBoolean }> = {
      title: 'Missing',
      description: 'short',
      inputSchema: { repo: z.string() },
      outputSchema: { ok: z.boolean() },
    };
    void missingAnnotations;

    const missingReadOnlyHint: ToolRegistration<{ repo: z.ZodString }, { ok: z.ZodBoolean }> = {
      title: 'Missing',
      description: 'short',
      inputSchema: { repo: z.string() },
      outputSchema: { ok: z.boolean() },
      // @ts-expect-error — omitting `readOnlyHint` must be a compile error:
      // it is required, never defaulted (the anti-"defaulting readOnlyHint"
      // red flag).
      annotations: {},
    };
    void missingReadOnlyHint;

    expect(true).toBe(true);
  });
});

describe('get_blast_radius — the stub (REQ-21, D8, §5.13.6)', () => {
  it('registers with the frozen §5.13.6 description, readOnlyHint:true, and issues no fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { server, registered } = createFakeServer();

    registerGetBlastRadius(server);

    expect(registered).toHaveLength(1);
    const tool = registered[0]!;
    expect(tool.name).toBe('get_blast_radius');
    expect(tool.config.annotations).toEqual({ readOnlyHint: true });

    const description = tool.config.description as string;
    expect(Buffer.byteLength(description, 'utf8')).toBe(285);
    expect(description.startsWith('Not implemented')).toBe(true);

    const result = await tool.handler({ repo: 'maxfurmanov/devdigest', pr: 42 });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text.startsWith('Not implemented')).toBe(true);

    const structured = z.object(GetBlastRadiusOutput).parse(result.structuredContent);
    expect(structured.implemented).toBe(false);
    expect(structured.retry).toBe(false);
    expect(structured.use_instead).toBe('get_findings');
    expect(structured.reason).toBe('Blast radius is not wired up yet.');

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
