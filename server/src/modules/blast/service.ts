import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type {
  BlastResponse,
  BlastIndexInfo,
  BlastLink,
  BlastRadius,
  PrHistory,
} from '@devdigest/shared';
import { BlastRepository } from './repository.js';

/**
 * Derive BlastResult and BlastCallerRow from the container's repoIntel interface
 * without importing from repo-intel/types.ts (module isolation rule).
 */
type BlastResult = Awaited<ReturnType<Container['repoIntel']['getBlastRadius']>>;
type BlastCallerRow = BlastResult['callers'][number];

const CALLER_CAP_PER_SYMBOL = 20;

/**
 * Files whose "endpoints" are test-case URLs (app.inject targets), not real
 * routes — they must never feed endpoint/cron attribution.
 */
const TEST_PATH_RE = /(\.test\.|\.spec\.|__tests__\/|\/tests?\/)/;

/**
 * A single file declaring more endpoints than this is a registration hub
 * (app.ts, server.ts, the DI container) rather than a route module. Endpoints
 * from such a file are NOT attributed to a symbol merely referenced from it —
 * that would dump every app route onto e.g. a background reaper.
 */
const HUB_ENDPOINT_LIMIT = 5;

/** Linear-scan dedupe (kept deliberately simple for the demo dataset). */
function dedupeStrings(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (!out.some((existing) => existing === v)) out.push(v);
  }
  return out;
}

/**
 * BlastService — assembles a BlastResponse for a given PR.
 *
 * No LLM calls. Everything is derived from:
 *  - blast/repository.ts (PR-domain reads: pr row, pr_files, prior PRs)
 *  - container.repoIntel (index reads only: getBlastRadius, getImporters, getIndexState)
 */
export class BlastService {
  private _repo: BlastRepository | null = null;

  /**
   * `repo` override is for unit tests; route tests instead swap container.db
   * before the first getBlast() call and rely on the lazy init below.
   */
  constructor(
    private container: Container,
    repo?: BlastRepository,
  ) {
    if (repo) this._repo = repo;
  }

  private get repo(): BlastRepository {
    // Lazily create so tests can patch container.db before the first call.
    if (!this._repo) {
      this._repo = new BlastRepository(this.container.db);
    }
    return this._repo;
  }

  async getBlast(workspaceId: string, prId: string): Promise<BlastResponse> {
    // 1. PR row — 404 if absent or in a different workspace.
    const pr = await this.repo.getPr(workspaceId, prId);
    if (!pr) throw new NotFoundError('PR not found');

    // 2. Changed files.
    const changedFiles = await this.repo.getPrFilePaths(workspaceId, prId);

    // 3. Index state.
    const indexState = await this.container.repoIntel.getIndexState(pr.repoId);
    const index: BlastIndexInfo = {
      status: indexState.status,
      degraded: !!indexState.degraded,
      reason: indexState.degradedReason ?? null,
    };

    // 4. Blast result — skip when no files changed.
    let blastResult: BlastResult;
    if (changedFiles.length === 0) {
      blastResult = {
        changedSymbols: [],
        callers: [],
        impactedEndpoints: [],
        degraded: true,
        reason: 'no_data',
      };
    } else {
      blastResult = await this.container.repoIntel.getBlastRadius(
        pr.repoId,
        changedFiles,
      );
    }

    // 5. Group callers by viaSymbol; cap at CALLER_CAP_PER_SYMBOL per symbol.
    //    Record clamped-remainder counts in `truncated`.
    const callersBySymbol = new Map<string, BlastCallerRow[]>();
    for (const caller of blastResult.callers) {
      const arr = callersBySymbol.get(caller.viaSymbol) ?? [];
      arr.push(caller);
      callersBySymbol.set(caller.viaSymbol, arr);
    }

    const truncated: Record<string, number> = {};

    const changedSymbols = blastResult.changedSymbols;
    const factsByFile = blastResult.factsByFile;

    // Only symbols with at least one caller appear in the tree — a changed
    // symbol nobody calls has no downstream impact to show (design rule).
    const impactedSymbols = changedSymbols.filter(
      (sym) => (callersBySymbol.get(sym.name) ?? []).length > 0,
    );

    // 6/7. Build downstream impacts per symbol.
    //    Endpoint/cron attribution comes from the symbol's DIRECT caller files
    //    only (level 1) — a route module that calls the changed symbol serves
    //    the endpoints declared in that same file. Registration HUBS (app.ts,
    //    server.ts, container) import/register the whole app, so their
    //    file_facts list every endpoint; attributing those to a symbol merely
    //    *referenced* from the hub (e.g. a background reaper) produces a wall of
    //    unrelated routes. Such files are excluded (endpoint count > HUB limit).
    //    When factsByFile is absent (degraded path): attribute impactedEndpoints
    //    to the FIRST symbol only (deterministic), crons empty.
    let totalCallers = 0;
    let totalEndpoints = 0;
    let totalCrons = 0;

    // cron value → declaring file(s), so the UI can label a cron by its file
    // instead of the raw expression. Pure index data (file_facts), no analysis.
    const cronFiles: Record<string, string[]> = {};

    const downstream = impactedSymbols.map((sym, idx) => {
      const allCallersForSymbol = callersBySymbol.get(sym.name) ?? [];
      const capped = allCallersForSymbol.slice(0, CALLER_CAP_PER_SYMBOL);
      const hidden = allCallersForSymbol.length - capped.length;
      if (hidden > 0) {
        truncated[sym.name] = hidden;
      }

      totalCallers += capped.length;

      // Unique direct caller files for this symbol.
      const callerFiles = new Set(capped.map((c) => c.file));

      // Endpoint/cron attribution.
      let endpointsForSymbol: string[];
      let cronsForSymbol: string[];

      if (factsByFile) {
        const epSet = new Set<string>();
        const cronSet = new Set<string>();
        for (const file of callerFiles) {
          // Skip test files (inject-target URLs, not real routes).
          if (TEST_PATH_RE.test(file)) continue;
          const facts = factsByFile[file];
          if (!facts) continue;
          // Skip registration hubs — they "declare" the whole app's routes.
          if (facts.endpoints.length > HUB_ENDPOINT_LIMIT) continue;
          for (const ep of facts.endpoints) epSet.add(ep);
          for (const cr of facts.crons) {
            cronSet.add(cr);
            const src = (cronFiles[cr] ??= []);
            if (!src.includes(file)) src.push(file);
          }
        }

        endpointsForSymbol = dedupeStrings(Array.from(epSet));
        cronsForSymbol = dedupeStrings(Array.from(cronSet));
      } else {
        // Degraded path: attribute impactedEndpoints to first symbol only.
        endpointsForSymbol = idx === 0 ? blastResult.impactedEndpoints : [];
        cronsForSymbol = [];
      }

      totalEndpoints += endpointsForSymbol.length;
      totalCrons += cronsForSymbol.length;

      return {
        symbol: sym.name,
        callers: capped.map((c) => ({
          name: c.symbol,
          file: c.file,
          line: c.line,
        })),
        endpoints_affected: endpointsForSymbol,
        crons_affected: cronsForSymbol,
      };
    });

    // Impact-first ordering (design rule): symbols whose callers reach
    // endpoints/crons come first, then by caller count, then by name — so the
    // colored badges are visible at the top of the tree without scrolling.
    downstream.sort((a, b) => {
      const impactA = a.endpoints_affected.length + a.crons_affected.length;
      const impactB = b.endpoints_affected.length + b.crons_affected.length;
      if (impactB !== impactA) return impactB - impactA;
      if (b.callers.length !== a.callers.length) return b.callers.length - a.callers.length;
      return a.symbol.localeCompare(b.symbol);
    });

    // 8. Deterministic summary string (zero LLM calls).
    const summary =
      `${changedSymbols.length} symbol${changedSymbols.length !== 1 ? 's' : ''} changed` +
      ` · ${totalCallers} caller${totalCallers !== 1 ? 's' : ''}` +
      ` · ${totalEndpoints} endpoint${totalEndpoints !== 1 ? 's' : ''}` +
      ` · ${totalCrons} cron${totalCrons !== 1 ? 's' : ''} reachable`;

    const blast: BlastRadius | null =
      changedSymbols.length > 0 || totalCallers > 0
        ? { changed_symbols: changedSymbols, downstream, summary }
        : null;

    // 9. Prior PRs.
    const priorPrs = await this.repo.getPriorPrs(
      workspaceId,
      pr.repoId,
      changedFiles,
      prId,
    );
    const history: PrHistory = { history: priorPrs };

    // 10. GitHub blob link.
    const repoBasics = await this.repo.getRepoBasics(pr.repoId);
    const link: BlastLink | null = repoBasics
      ? { owner: repoBasics.owner, repo: repoBasics.name, head_sha: pr.headSha }
      : null;

    // 11. available flag.
    const available = blast !== null;

    const result: BlastResponse = {
      available,
      blast,
      history,
      index,
      link,
      ...(Object.keys(truncated).length > 0 ? { truncated } : {}),
      ...(Object.keys(cronFiles).length > 0 ? { cron_files: cronFiles } : {}),
    };

    return result;
  }
}
