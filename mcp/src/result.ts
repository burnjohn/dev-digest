/**
 * Layer-neutral result helpers — produce CallToolResult values (the SDK wire
 * type returned from every tool handler).
 *
 * This module sits outside the presentation/application/infrastructure layers
 * so BOTH `tools/` (presentation) and `workflows/` (application) may import it
 * without crossing a dependency boundary.
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ApiErr } from './api-client.js';

/**
 * Returns a CallToolResult that signals an error to the MCP client.
 * The message should already be enriched (actionable, no raw stack traces).
 */
export function errorResult(message: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

/**
 * Returns a CallToolResult with a JSON-serialised payload.
 * data is pretty-printed (2-space indent) for readability in the client.
 */
export function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

/**
 * Converts a failed ApiResult error into an errorResult.
 * The message field on ApiErr is already enriched by api-client.ts — no re-enrichment needed.
 */
export function apiErrorResult(err: ApiErr): CallToolResult {
  return errorResult(err.message);
}
