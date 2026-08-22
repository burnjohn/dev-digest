# Application Layer

`modules/*/service.ts` — orchestrates the domain using infrastructure. Contains use cases: sequences of steps that fulfill a user or system intent.

---

## Service Responsibilities

A service method does these things (in order):

1. **Resolve dependencies** from `Container` (via constructor)
2. **Validate preconditions** — check that the operation is allowed at the application level
3. **Fetch data** — call repositories for what's needed
4. **Orchestrate** — call adapters, other services, or repos in the right order
5. **Return a DTO** — a type from `vendor/shared/contracts/`, never a raw DB row

```typescript
export class AgentsService {
  private repo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }

  // ✅ Service method anatomy
  async getById(workspaceId: string, agentId: string): Promise<Agent> {
    // 1. Fetch
    const agent = await this.repo.getById(workspaceId, agentId);
    // 2. Guard
    if (!agent) throw new NotFoundError(`Agent ${agentId}`);
    // 3. Return DTO (already mapped by repo's toDomain())
    return agent;
  }
}
```

---

## What Services MUST NOT Do

```typescript
// ❌ Direct DB query in service
async listAgents(workspaceId: string) {
  return this.container.db              // BAD — bypass repository layer
    .select()
    .from(t.agents)
    .where(eq(t.agents.workspaceId, workspaceId));
}

// ❌ Adapter instantiation in service
async runWithLLM(prompt: string) {
  const llm = new OpenAIProvider(apiKey);   // BAD — instantiation outside container
  return llm.complete({ prompt });
}

// ❌ HTTP knowledge in service
async createAgent(req: FastifyRequest) {     // BAD — service knows about HTTP
  const { name } = req.body as { name: string };
}

// ❌ Returning raw DB rows
async list(workspaceId: string): Promise<AgentRow[]> {  // BAD — AgentRow leaks Drizzle
  return this.repo.rawList(workspaceId);
}
```

---

## Receiving Adapters from Container

Adapters are never instantiated in services — pulled from Container:

```typescript
export class ReviewRunExecutor {
  constructor(
    private container: Container,
    private repo: ReviewRepository,
  ) {}

  async execute(runId: string, ...): Promise<void> {
    // ✅ Get adapter from container — Container owns instantiation
    const llm = await this.container.llm('openai');
    const result = await llm.completeStructured({ schema: ReviewSchema, ... });

    const github = await this.container.github;
    const diff = await github.getDiff(owner, repo, prNumber);
  }
}
```

---

## Fire-and-Forget Pattern

For long-running operations (review runs, indexing), the service returns immediately and runs the heavy work in the background:

```typescript
async runReview(workspaceId: string, prId: string, targets: AgentRow[]) {
  // 1. Create run records synchronously
  const runs: RunInfo[] = [];
  for (const agent of targets) {
    const runId = await this.repo.createAgentRun({ workspaceId, prId, agentId: agent.id });
    runs.push({ run_id: runId, agent_id: agent.id });
  }

  // 2. Fire background execution — HTTP returns NOW
  void this.executor.executeRuns(workspaceId, pull, repo, jobs).catch((err) => {
    logger?.error({ err }, 'background execution crashed');
  });

  // 3. Client polls SSE for progress
  return { runs };
}
```

Rules for fire-and-forget:
- Always catch errors from the background promise (never let them go silently)
- Use `RunBus.publish()` to emit progress events
- Use `JobRunner` for CPU-bound or cancelable work

---

## Cross-Service Orchestration

Services may call other services when workflows span modules:

```typescript
export class ReviewService {
  constructor(private container: Container) {
    this.repo = new ReviewRepository(container.db);
    // ✅ Access to other module's repository via Container
    this.agents = container.agentsRepo;
  }

  async runReview(workspaceId: string, prId: string) {
    // ✅ Use container's pre-built property for cross-module data
    const agents = await this.agents.list(workspaceId);
    const pull = await this.repo.getPull(workspaceId, prId);
    // ...
  }
}
```

Never skip the service layer to reach another module's repository directly.

---

## Application-Level Validation

The service is responsible for business preconditions that aren't expressible in HTTP schemas:

```typescript
async linkSkill(workspaceId: string, agentId: string, skillId: string) {
  const agent = await this.repo.getById(workspaceId, agentId);
  if (!agent) throw new NotFoundError(`Agent ${agentId}`);

  const existing = await this.repo.linkedSkills(agentId);
  if (existing.length >= 10) {
    // ✅ Application-level business rule
    throw new AppError('skill_limit_exceeded', 'An agent may have at most 10 skills', 422);
  }

  await this.repo.linkSkill(agentId, skillId);
}
```

This is different from HTTP validation (Zod in routes) and domain invariants (guard clauses in entities).
