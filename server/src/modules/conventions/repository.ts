import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type {
  ConventionCategory,
  ConventionSignals,
  ConventionStatus,
  ProbeStrategy,
} from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * L02 — conventions data-access. Owns `conventions` and `convention_scans`.
 *
 * It also READS `repos` (for the clone path + display name) and `skills` (for the
 * dedup pass against rules the workspace already has). Sanctioned by the same rule
 * as `skills/repository.ts` reading `agent_skills`: the onion ban is on importing
 * another MODULE, not on reading its table. Nothing here writes to either.
 *
 * Workspace-scoped throughout — every public method takes `workspaceId`, and no
 * query can reach a row belonging to another tenant.
 */

import type { ConventionRow, ConventionScanRow } from '../../db/rows.js';
export type { ConventionRow, ConventionScanRow };

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  category: ConventionCategory;
  rule: string;
  rationale: string | null;
  evidencePath: string;
  evidenceSnippet: string;
  evidenceStartLine: number;
  evidenceEndLine: number;
  /** Distinct supporting FILES — always `supportFiles.length`. */
  supportCount: number;
  supportFiles: string[];
  /** Conforming SITES in the probe strategy's unit; may exceed `supportCount`. */
  followCount: number;
  /** `null` = no denominator was measurable. NOT interchangeable with 0. */
  violationCount: number | null;
  conformance: number | null;
  probeStrategy: ProbeStrategy;
  configDeclared: boolean;
  signals: ConventionSignals;
  confidence: number;
}

export interface UpdateConvention {
  rule?: string;
  evidenceSnippet?: string;
  status?: ConventionStatus;
}

export interface InsertScan {
  workspaceId: string;
  repoId: string;
  sampledFiles: number;
  selectedFiles: number;
  rawCount: number;
  keptCount: number;
  droppedUngrounded: number;
  droppedUnsupported: number;
  droppedDuplicate: number;
  countedFiles: number;
  countedSymbols: number;
  model: string | null;
  costUsd: number | null;
}

/** The repo fields extraction needs: display name + whether it is even cloned. */
export interface RepoBasics {
  id: string;
  owner: string;
  name: string;
  clonePath: string | null;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async getRepoBasics(workspaceId: string, repoId: string): Promise<RepoBasics | undefined> {
    const [row] = await this.db
      .select({
        id: t.repos.id,
        owner: t.repos.owner,
        name: t.repos.name,
        clonePath: t.repos.clonePath,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  /**
   * Every candidate for a repo, strongest rule first.
   *
   * The `id` key is what makes this a TOTAL order, and it is not optional.
   * `confidence` is rounded to 2 decimals, so ties are routine — and `createdAt`
   * does not break them: `replacePending` inserts a whole scan in ONE transaction,
   * where `now()` is the transaction timestamp, so every row of a scan carries the
   * SAME `createdAt`. With both keys tied Postgres returns heap order, and an
   * `UPDATE` (accepting a rule) rewrites the tuple at the end of the heap — so the
   * card the user just accepted jumped position on the next refetch. `id` is a uuid:
   * arbitrary, but unique and never rewritten by a status patch.
   */
  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)))
      .orderBy(desc(t.conventions.confidence), asc(t.conventions.createdAt), asc(t.conventions.id));
  }

  async listByStatus(
    workspaceId: string,
    repoId: string,
    status: ConventionStatus,
  ): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, status),
        ),
      )
      .orderBy(desc(t.conventions.confidence), asc(t.conventions.createdAt), asc(t.conventions.id));
  }

  /**
   * Every rule already on this repo's list, whatever its status — the dedup memory.
   *
   * All three statuses belong here, and `pending` is the load-bearing one: scans
   * MERGE rather than replace (see `mergePending`), so a pending rule left out of
   * this corpus would be re-inserted verbatim on the next scan and the list would
   * grow a copy of itself every run. `rejected` stops a turned-down rule coming
   * back; `accepted` stops a reworded twin of a rule the user already approved.
   */
  async listExistingRules(
    workspaceId: string,
    repoId: string,
  ): Promise<{ id: string; rule: string; status: ConventionStatus; confidence: number | null }[]> {
    return this.db
      .select({
        id: t.conventions.id,
        rule: t.conventions.rule,
        status: t.conventions.status,
        confidence: t.conventions.confidence,
      })
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionRow | undefined> {
    const set = {
      ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
      ...(patch.evidenceSnippet !== undefined ? { evidenceSnippet: patch.evidenceSnippet } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    };
    // An empty patch would compile into `UPDATE … SET` with no assignments — a
    // syntax error, not a no-op. The route's schema allows `{}`.
    if (Object.keys(set).length === 0) return this.getById(workspaceId, id);
    const [row] = await this.db
      .update(t.conventions)
      .set(set)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /**
   * Add this scan's new candidates to the repo's existing list. NOTHING is deleted.
   *
   * This used to delete every `pending` row first, which made the page a snapshot of
   * the latest scan rather than a collection: a scan reads only 12-14 of the 40
   * sampled files, so each run sees a different slice of the repo and a rule
   * vanished simply because its evidence file wasn't sampled that time. Merging is
   * right for the same reason — a later run finding something new is additive
   * evidence, not a replacement verdict.
   *
   * What keeps the list from growing duplicates is now the dedup pass in the
   * service, which compares every candidate against `listExistingRules` BEFORE
   * anything reaches here. A caller that skips it will duplicate the whole list.
   */
  async mergePending(rows: InsertConvention[]): Promise<ConventionRow[]> {
    if (rows.length === 0) return [];
    return this.db
      .insert(t.conventions)
      .values(rows.map((r) => ({ ...r, status: 'pending' as const })))
      .returning();
  }

  /**
   * Re-score a pending row that a later scan re-confirmed more strongly.
   *
   * Rows are permanent now, so a stale score would be permanent too: a rule first
   * seen in a thin sample would keep that weak confidence forever even after a
   * wider scan measured it properly. Only the measured numbers are written — never
   * `rule`, never `status`, which are the user's.
   */
  async refreshPending(
    workspaceId: string,
    id: string,
    values: Pick<
      InsertConvention,
      | 'supportCount'
      | 'supportFiles'
      | 'followCount'
      | 'violationCount'
      | 'conformance'
      | 'signals'
      | 'confidence'
    >,
  ): Promise<void> {
    await this.db
      .update(t.conventions)
      .set(values)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.id, id),
          eq(t.conventions.status, 'pending'),
        ),
      );
  }

  /** Stamp the skill a set of rules shipped in. Ignores ids from another tenant. */
  async stampSkillId(workspaceId: string, ids: string[], skillId: string): Promise<number> {
    if (ids.length === 0) return 0;
    const rows = await this.db
      .update(t.conventions)
      .set({ skillId })
      .where(and(eq(t.conventions.workspaceId, workspaceId), inArray(t.conventions.id, ids)))
      .returning({ id: t.conventions.id });
    return rows.length;
  }

  async insertScan(values: InsertScan): Promise<ConventionScanRow> {
    const [row] = await this.db.insert(t.conventionScans).values(values).returning();
    if (!row) throw new Error('convention_scans insert returned no row');
    return row;
  }

  async latestScan(workspaceId: string, repoId: string): Promise<ConventionScanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionScans)
      .where(
        and(
          eq(t.conventionScans.workspaceId, workspaceId),
          eq(t.conventionScans.repoId, repoId),
        ),
      )
      .orderBy(desc(t.conventionScans.createdAt))
      .limit(1);
    return row;
  }

  /** Bodies of the workspace's existing skills — dedup pass 1 compares against these. */
  async listSkillBodies(workspaceId: string): Promise<string[]> {
    const rows = await this.db
      .select({ name: t.skills.name, body: t.skills.body })
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId));
    return rows.map((r) => `${r.name} ${r.body}`);
  }
}
