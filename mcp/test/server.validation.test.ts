/**
 * End-to-end input-validation test through the real MCP server (Step 5/6 + plan §6 AC10).
 *
 * Unlike the per-tool tests (which call `descriptor.handler` directly and bypass the
 * SDK's Zod gate), this test wires a Client to the server over an in-memory transport
 * pair and invokes tools through `client.callTool`, so the SDK's `registerTool` input
 * validation actually runs. It pins down the REAL behaviour for a malformed UUID:
 * the SDK returns `{ isError: true }` with a message naming the tool and the bad field
 * (it does NOT throw / reject), and the tool handler is never reached.
 */

import { describe, it, expect, vi } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ReviewRecord } from '@devdigest/shared';
import { createDevDigestMcpServer } from '../src/server.js';
import { makeOk } from './setup.js';

// Guard against accidental network: SDK validation blocks invalid UUIDs before the
// handler runs, but mock api-client anyway so no handler can ever reach `fetch`.
vi.mock('../src/api-client.js', () => ({
  fetchAgents: vi.fn(),
  fetchRepoPulls: vi.fn(),
  postReview: vi.fn(),
  fetchRuns: vi.fn(),
  fetchReviews: vi.fn(),
  fetchConventions: vi.fn(),
  fetchBrief: vi.fn(),
  fetchBlast: vi.fn(),
  enrichMessage: vi.fn((_c: string, m: string) => m),
}));

import * as apiClient from '../src/api-client.js';

async function connect() {
  const server = createDevDigestMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { server, client };
}

function text(res: unknown, i = 0): string {
  const content = (res as { content?: Array<{ type?: string; text?: unknown }> }).content;
  const block = content?.[i];
  if (!block || block.type !== 'text' || typeof block.text !== 'string') {
    throw new Error('expected text content');
  }
  return block.text;
}

describe('MCP SDK input validation (UUID gate, plan §6 AC10)', () => {
  it('rejects a malformed pr_id with isError + an actionable message naming the field', async () => {
    const { server, client } = await connect();
    const res = await client.callTool({ name: 'get_findings', arguments: { pr_id: 'not-a-uuid' } });

    expect(res.isError).toBe(true);
    const t = text(res);
    expect(t).toMatch(/uuid/i);
    expect(t).toContain('pr_id');
    expect(apiClient.fetchReviews).not.toHaveBeenCalled(); // handler never ran

    await client.close();
    await server.close();
  });

  it('rejects malformed UUIDs on run_agent_on_pr before any review is started', async () => {
    const { server, client } = await connect();
    const res = await client.callTool({
      name: 'run_agent_on_pr',
      arguments: { repo_id: 'x', pr_id: 'y', agent_id: 'z' },
    });

    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/uuid/i);
    expect(apiClient.postReview).not.toHaveBeenCalled();
    expect(apiClient.fetchRepoPulls).not.toHaveBeenCalled();

    await client.close();
    await server.close();
  });

  it('accepts a well-formed UUID: validation passes and the handler is invoked', async () => {
    vi.mocked(apiClient.fetchReviews).mockResolvedValue(makeOk([] as ReviewRecord[]));
    const { server, client } = await connect();
    const validUuid = '11111111-1111-4111-8111-111111111111';

    const res = await client.callTool({ name: 'get_findings', arguments: { pr_id: validUuid } });

    expect(res.isError).toBeFalsy();
    expect(apiClient.fetchReviews).toHaveBeenCalledWith(validUuid);

    await client.close();
    await server.close();
  });
});
