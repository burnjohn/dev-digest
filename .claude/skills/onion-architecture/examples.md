# Examples

## 1. Route handler with inline Drizzle

**Bad** (the pattern in `modules/pulls/routes.ts` today):

```ts
// modules/pulls/routes.ts
app.get('/pulls/:id', async (req, reply) => {
  const { workspaceId } = getContext(container, req);
  const [pull] = await container.db
    .select()
    .from(schema.pulls)
    .where(and(eq(schema.pulls.id, req.params.id), eq(schema.pulls.workspaceId, workspaceId)));
  if (!pull) throw new NotFoundError('pull not found');
  return pull;
});
```

Why it hurts: the handler now depends on the schema shape directly — any column rename
breaks the route, not the repository, and the row type (`PullRow`) leaks straight into the
HTTP response.

**Good**:

```ts
// modules/pulls/infrastructure/http/routes.ts
app.get('/pulls/:id', async (req) => {
  const { workspaceId } = getContext(container, req);
  return pullService.getById(workspaceId, req.params.id);
});

// modules/pulls/application-services/pull-service.ts
export class PullService {
  constructor(private readonly repo: PullRepository) {}
  async getById(workspaceId: string, id: string): Promise<Pull> {
    const row = await this.repo.findById(workspaceId, id);
    if (!row) throw new NotFoundError('pull not found');
    return toDomainPull(row);
  }
}

// modules/pulls/infrastructure/persistence/pull-repository.ts
export class PullRepository {
  constructor(private readonly db: Db) {}
  findById(workspaceId: string, id: string) {
    return this.db.query.pulls.findFirst({
      where: and(eq(schema.pulls.id, id), eq(schema.pulls.workspaceId, workspaceId)),
    });
  }
}
```

## 2. A row type leaking into a service signature

**Bad**:

```ts
// modules/reviews/service.ts
async function scoreReview(pull: PullRow): Promise<number> { ... }
```

Why it hurts: the application layer now knows about `pr_files`/`pr_commits` column names —
a migration can silently break business logic that has nothing to do with persistence.

**Good**:

```ts
// modules/reviews/domain-model/pull.ts
export interface Pull {
  id: string;
  title: string;
  headSha: string;
}

// modules/reviews/infrastructure/persistence/pull-repository.ts
function toDomainPull(row: PullRow): Pull {
  return { id: row.id, title: row.title, headSha: row.headSha };
}

// modules/reviews/application-services/review-service.ts
async function scoreReview(pull: Pull): Promise<number> { ... }
```

## 3. Non-atomic delete-then-insert

**Bad** (the pattern at `modules/pulls/routes.ts:251-265`):

```ts
await container.db.delete(schema.prFiles).where(eq(schema.prFiles.pullId, pullId));
await container.db.insert(schema.prFiles).values(newFiles);
// if the insert throws, the delete already committed — files are gone
```

Why it hurts: a failed insert leaves the pull with zero files instead of its old set — a
non-atomic write masquerading as a single operation.

**Good**:

```ts
// application-services/sync-pull-files.ts
async function syncPullFiles(pullId: string, files: NewFile[]) {
  await db.transaction(async (tx) => {
    await prFilesRepo.deleteByPullId(pullId, tx);
    await prFilesRepo.insertMany(files, tx);
  });
}

// infrastructure/persistence/pr-files-repository.ts
class PrFilesRepository {
  deleteByPullId(pullId: string, tx: Tx = this.db) {
    return tx.delete(schema.prFiles).where(eq(schema.prFiles.pullId, pullId));
  }
  insertMany(files: NewFile[], tx: Tx = this.db) {
    return tx.insert(schema.prFiles).values(files);
  }
}
```

## 4. Repository constructed inside a service

**Bad** (the pattern at `reviews/service.ts:34`, `repos/service.ts:36`,
`agents/service.ts:55`):

```ts
// modules/repos/service.ts
export class RepoService {
  private repo = new RepoRepository(container.db); // constructed here, not injected
}
```

Why it hurts: the service can't be unit-tested without a real `Db`, and there's no single
place to swap the repository for a fake — it's re-instantiated per service.

**Good**:

```ts
// modules/repos/application-services/repo-service.ts
export class RepoService {
  constructor(private readonly repo: RepoRepository) {}
}

// platform/container.ts
get repoRepository() {
  return this._repoRepository ??= new RepoRepository(this.db);
}
get repoService() {
  return this._repoService ??= new RepoService(this.repoRepository);
}
```

## 5. External SDK imported inside a module

**Bad**:

```ts
// modules/pulls/service.ts
import { Octokit } from 'octokit';

export class PullService {
  private octokit = new Octokit({ auth: token });
  async fetchDiff(owner: string, repo: string, num: number) {
    return this.octokit.rest.pulls.get({ owner, repo, pull_number: num });
  }
}
```

Why it hurts: the application service is now coupled to GitHub's SDK and REST shape — it
can't be tested without hitting the network, and swapping providers means editing business
logic.

**Good**:

```ts
// modules/pulls/domain-services/ports.ts
export interface GitHostPort {
  fetchDiff(owner: string, repo: string, num: number): Promise<Diff>;
}

// src/adapters/github/octokit-git-host.ts
export class OctokitGitHost implements GitHostPort {
  constructor(private readonly client: Octokit) {}
  async fetchDiff(owner: string, repo: string, num: number) {
    const res = await this.client.rest.pulls.get({ owner, repo, pull_number: num });
    return toDiff(res.data);
  }
}

// modules/pulls/application-services/pull-service.ts
export class PullService {
  constructor(private readonly gitHost: GitHostPort) {}
  fetchDiff(owner: string, repo: string, num: number) {
    return this.gitHost.fetchDiff(owner, repo, num);
  }
}
```
