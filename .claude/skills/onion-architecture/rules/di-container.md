# DI Container

`src/platform/container.ts` is the composition root. The single place where all concrete adapter classes are instantiated and wired together.

---

## Container Structure

```typescript
export class Container {
  readonly config: AppConfig;
  readonly db: Db;
  readonly secrets: SecretsProvider;
  readonly jobs: JobRunner;
  readonly runBus: RunBus;

  // Pre-built repositories (shared across modules)
  readonly agentsRepo: AgentsRepository;

  constructor(config: AppConfig, db: Db, overrides?: ContainerOverrides) {
    this.config = config;
    this.db = db;
    this.secrets = overrides?.secrets ?? new LocalSecretsProvider(config.secretsPath);
    this.jobs = new JobRunner();
    this.runBus = new RunBus();
    this.agentsRepo = new AgentsRepository(db);
  }

  // Lazy-loaded adapters — expensive or optional resources
  get git(): GitClient {
    return this._git ?? (this._git = new SimpleGitClient());
  }

  async llm(provider: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    // Instantiates on first call, caches afterward
    const key = await this.secrets.get(LLM_KEY_MAP[provider]);
    return new ProviderMap[provider](key);
  }

  // Invalidate caches when secrets change (settings update)
  invalidateSecretCaches() { this._git = undefined; /* etc. */ }
}
```

---

## The One Rule: `new` Only in Container

```typescript
// ✅ CORRECT — all instantiation in container.ts
export class Container {
  readonly agentsRepo = new AgentsRepository(this.db);
  get github() { return this._github ?? (this._github = new OctokitGitHubClient(token)); }
}

// ❌ WRONG — instantiating adapter inside a service
export class ReviewService {
  constructor(private container: Container) {
    this.llm = new OpenAIProvider(process.env.OPENAI_API_KEY!);  // BAD
  }
}

// ❌ WRONG — instantiating in a route handler
fastify.post('/review', async (req) => {
  const service = new ReviewService(new Container(...));  // BAD — Container created inside handler
});
```

If a service needs a new dependency, add it to `Container`, then pull it via `this.container.xxx`.

---

## How Services Use the Container

Services receive `Container` in their constructor and pull what they need:

```typescript
export class ReviewService {
  private repo: ReviewRepository;
  private agents: AgentsRepository;

  constructor(private container: Container) {
    // ✅ Instantiate own-module repo here (it's cheap)
    this.repo = new ReviewRepository(container.db);
    // ✅ Use pre-built shared repos from Container
    this.agents = container.agentsRepo;
  }

  async runReview(...) {
    // ✅ Pull adapter from Container when needed (lazy)
    const llm = await this.container.llm('openai');
    const github = await this.container.github;
  }
}
```

---

## Test Doubles: `ContainerOverrides`

Never use `vi.mock()` on a module — inject test doubles via `ContainerOverrides`:

```typescript
// ✅ CORRECT — inject mock via ContainerOverrides
import { mockContainer } from '../adapters/mocks';

const container = new Container(testConfig, db, {
  llm: { openai: new MockLLMProvider() },
  github: new MockGitHubClient(),
  secrets: new MockSecretsProvider({ OPENAI_API_KEY: 'test' }),
});
const service = new ReviewService(container);
// → service uses MockLLMProvider, no real API calls

// ❌ WRONG — module mocking (test smell)
vi.mock('../adapters/llm/openai', () => ({ OpenAIProvider: vi.fn() }));
// BAD: couples test to module path; breaks when file moves; hard to type
```

**Why `vi.mock()` is a code smell here:** if you need to mock a module rather than a constructor parameter, the dependency should be injected instead. The `ContainerOverrides` type makes the injection points explicit and type-safe.

---

## Lazy Adapters vs Eager Repositories

| Pattern | When to use |
|---|---|
| Eager (set in constructor) | Repos, RunBus, JobRunner — cheap, always needed |
| Lazy getter (get prop) | Git, embedding clients — optional or conditionally used |
| Async factory (async method) | LLM providers — need async secret fetch; multiple variants |

```typescript
// Eager — always created
readonly agentsRepo = new AgentsRepository(this.db);

// Lazy sync — first access creates, then cached
get git(): GitClient {
  return (this._git ??= new SimpleGitClient(this.config.cloneDir));
}

// Async factory — per-provider, needs secret
async llm(provider: 'openai' | 'anthropic'): Promise<LLMProvider> {
  if (this._llm[provider]) return this._llm[provider]!;
  const key = await this.secrets.get(KEY_MAP[provider]);
  this._llm[provider] = new PROVIDER_MAP[provider](key);
  return this._llm[provider]!;
}
```

---

## `ContainerOverrides` Type

Keeps the override surface explicit and type-safe:

```typescript
export interface ContainerOverrides {
  secrets?: SecretsProvider;
  llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>;
  github?: GitHubClient;
  git?: GitClient;
  embedder?: Embedder;
}
```

Only override what the test needs — all other dependencies use production implementations.

---

## Module Registration

Modules (Fastify plugins) receive `Container` as a plugin option, never import it globally:

```typescript
// app.ts — composition root for HTTP
await fastify.register(agentsRoutes, { container });
await fastify.register(reviewsRoutes, { container });

// modules/agents/routes.ts
export const agentsRoutes: FastifyPluginAsync<{ container: Container }> = async (
  fastify, { container }
) => {
  const service = new AgentsService(container);
  // ...
};
```

This keeps modules stateless and testable — you can register a single module plugin with a test container in integration tests.
