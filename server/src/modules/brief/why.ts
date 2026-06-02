import { and, eq } from 'drizzle-orm';
import type { RepoRef } from '@devdigest/shared';
import type { WhyTimeline, WhyEvent } from '@devdigest/shared/contracts/why';
import type { Container } from '../../platform/container.js';
import * as t from '../../db/schema.js';
import { NotFoundError } from '../../platform/errors.js';
import { parsePr, summarizeWhy } from './helpers.js';

/**
 * A3 — git-why service (L04).
 *
 * `GET /pulls/:id/why?file&line` → WhyTimeline: walk git blame + log (via
 * `container.git`) to reconstruct the commits — and PRs (parsed from commit
 * messages) — that shaped a file/line. Powers the WhyTimeline drawer (key `w`).
 */
export class WhyService {
  constructor(private container: Container) {}

  async forLine(
    workspaceId: string,
    prId: string,
    file: string,
    line: number,
  ): Promise<WhyTimeline> {
    const [pull] = await this.container.db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!pull) throw new NotFoundError('Pull request not found');
    const [repo] = await this.container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, pull.repoId));
    if (!repo) throw new NotFoundError('Repo not found');

    const ref: RepoRef = { owner: repo.owner, name: repo.name };

    let blame: WhyEvent | null = null;
    let events: WhyEvent[] = [];

    try {
      const blameLines = await this.container.git.blame(ref, file);
      const hit = blameLines.find((b) => b.line === line) ?? blameLines[0];
      if (hit) {
        blame = {
          sha: hit.sha,
          summary: hit.summary,
          author: hit.author,
          date: hit.date,
          pr_number: parsePr(hit.summary),
          is_blame_head: true,
        };
      }
    } catch {
      /* blame unavailable (no clone) — fall through to log */
    }

    try {
      const log = await this.container.git.log(ref, file);
      events = log.map((c, i) => ({
        sha: c.sha,
        summary: c.message.split('\n')[0] ?? c.message,
        author: c.author,
        date: c.date,
        pr_number: parsePr(c.message),
        is_blame_head: i === 0 && !blame,
      }));
    } catch {
      /* log unavailable */
    }

    return {
      file,
      line,
      blame,
      events,
      summary: summarizeWhy(file, line, blame, events),
    };
  }
}
