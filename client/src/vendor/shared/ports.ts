import type { BlastRadiusResponse } from './contracts/blast-api.js';

/**
 * Internal cross-module ports. Complements `adapters.ts`, which is scoped to
 * ALL EXTERNAL calls (its own header, `adapters.ts:9-13`) — everything here is
 * a seam BETWEEN modules inside this process, never a call leaving it.
 *
 * `container.repoIntel` is the existing instance of this pattern: a module
 * depends on the interface below, never on the module that implements it, so
 * "no module imports another module" (`onion-architecture` §2, cross-cutting
 * rule 2) holds even where two modules need the same computation.
 */

/**
 * Implemented by `modules/blast`, consumed by `modules/reviews`'s risk-brief
 * service (`server/specs/SPEC-02-pr-risk-brief.md`, "Module interactions").
 * Resolves to `undefined` when the PR does not exist (or is not in the
 * caller's workspace) — the same contract `BlastService.getBlastRadius`
 * already documents (`modules/blast/service.ts:37-39`).
 */
export interface BlastProvider {
  getBlastRadius(workspaceId: string, prId: string): Promise<BlastRadiusResponse | undefined>;
}
