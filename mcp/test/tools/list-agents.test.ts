import { describe, it, expect, vi } from 'vitest';
import { makeAgent, makeOk, makeErr, getResultText } from '../setup.js';

// vi.mock must be at module scope so Vitest can hoist it.
// The specifier matches exactly what list-agents.ts imports from.
vi.mock('../../src/api-client.js', () => ({
  fetchAgents: vi.fn(),
  fetchRepoPulls: vi.fn(),
  postReview: vi.fn(),
  fetchRuns: vi.fn(),
  fetchReviews: vi.fn(),
  fetchConventions: vi.fn(),
  fetchBrief: vi.fn(),
  enrichMessage: vi.fn((code: string, message: string) => message),
}));

import { listAgentsTool } from '../../src/tools/list-agents.js';
import * as apiClient from '../../src/api-client.js';

const fetchAgentsMock = vi.mocked(apiClient.fetchAgents);

describe('list_agents tool', () => {
  describe('handler', () => {
    it('returns projected agents as JSON text when fetchAgents succeeds', async () => {
      const agents = [
        makeAgent({ id: 'id-1', name: 'Agent Alpha', system_prompt: 'private' }),
        makeAgent({ id: 'id-2', name: 'Agent Beta', enabled: false }),
      ];
      fetchAgentsMock.mockResolvedValue(makeOk(agents));

      const result = await listAgentsTool.handler();

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);

      const parsed = JSON.parse(getResultText(result));
      expect(parsed).toHaveLength(2);

      // Projected fields are present
      expect(parsed[0]).toMatchObject({ id: 'id-1', name: 'Agent Alpha' });
      expect(parsed[1]).toMatchObject({ id: 'id-2', name: 'Agent Beta', enabled: false });

      // Sensitive fields are dropped
      expect(parsed[0]).not.toHaveProperty('system_prompt');
      expect(parsed[0]).not.toHaveProperty('output_schema');
    });

    it('returns isError:true when fetchAgents returns an api error', async () => {
      fetchAgentsMock.mockResolvedValue(
        makeErr('network_error', 'DevDigest API is unreachable at http://localhost:3001; ensure the server is running'),
      );

      const result = await listAgentsTool.handler();

      expect(result.isError).toBe(true);
      expect(getResultText(result)).toContain('unreachable');
    });

    it('returns isError:true for a not_found error with an actionable hint', async () => {
      fetchAgentsMock.mockResolvedValue(
        makeErr('not_found', 'Agent not found; call list_agents to see valid agent IDs'),
      );

      const result = await listAgentsTool.handler();

      expect(result.isError).toBe(true);
      expect(getResultText(result)).toContain('list_agents');
    });
  });
});
