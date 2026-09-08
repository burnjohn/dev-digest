import type {
  AuthProvider,
  SecretsProvider,
  GitHubClient,
  GitClient,
  CodeIndex,
  Embedder,
  LLMProvider,
  FeatureModelId,
  FeatureModelChoice,
} from '@devdigest/shared';
import type { AppConfig } from './config.js';
import type { Db } from '../db/client.js';
import { JobRunner } from './jobs.js';
import { runBus, type RunBus } from './sse.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { LocalNoAuthProvider } from '../adapters/auth/local.js';
import { OctokitGitHubClient } from '../adapters/github/octokit.js';
import { SimpleGitClient } from '../adapters/git/simple-git.js';
import { RipgrepCodeIndex } from '../adapters/codeindex/ripgrep.js';
import { OpenAIProvider } from '../adapters/llm/openai.js';
import { AnthropicProvider } from '../adapters/llm/anthropic.js';
import { OpenAIEmbedder } from '../adapters/embedder/openai.js';
import { OpenRouterProvider } from '@devdigest/reviewer-core';
import { estimateCost } from '../adapters/llm/pricing.js';
import { PriceBook } from './price-book.js';
import { ConfigError } from './errors.js';
import { AgentsRepository } from '../modules/agents/repository.js';
import { SkillsRepository } from '../modules/skills/repository.js';
import { SkillsService } from '../modules/skills/service.js';
import { ReviewRepository } from '../modules/reviews/repository.js';
import { RepoRepository } from '../modules/repos/repository.js';
import { ProjectContextRepository } from '../modules/project-context/repository.js';
import { ProjectContextService } from '../modules/project-context/service.js';
import { OnboardingRepository } from '../modules/onboarding/repository.js';
import { OnboardingService } from '../modules/onboarding/service.js';
import { BriefRepository } from '../modules/brief/repository.js';
import { BriefService } from '../modules/brief/service.js';
import { readSpecFile } from '../modules/brief/clone.js';
import { EvalRepository } from '../modules/eval/repository.js';
import { EvalService } from '../modules/eval/service.js';
import { EvalExecutor } from '../modules/eval/executor.js';
import type { RepoIntel } from '../modules/repo-intel/types.js';
import { RepoIntelService } from '../modules/repo-intel/service.js';
import { resolveFeatureModel as resolveFeatureModelForWorkspace } from '../modules/settings/feature-models.js';
import { type DepGraph, DepCruiseGraph } from '../adapters/depgraph/index.js';
import { type Tokenizer, TiktokenTokenizer } from '../adapters/tokenizer/index.js';
import { IntentRepository } from '../modules/intent/repository.js';
import { IntentService } from '../modules/intent/service.js';
import { readClone } from '../modules/intent/clone.js';
import { MemoryRepository } from '../modules/memory/repository.js';
import { CiRepository } from '../modules/ci/repository.js';
import { CiService } from '../modules/ci/service.js';

/**
 * DI container. One per app instance. Holds config, db, the JobRunner,
 * the SSE bus, and lazily-constructed adapters resolved through SecretsProvider.
 *
 * Tests construct a container with `overrides` to inject mock adapters; the
 * Services depend on these interfaces, not the concrete classes.
 */
export interface ContainerOverrides {
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  github?: GitHubClient;
  git?: GitClient;
  codeIndex?: CodeIndex;
  embedder?: Embedder;
  /** Pre-built providers by id (skip key lookup). */
  llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>;
  /** repo-intel facade (T1.1+) — tests inject mock RepoIntel implementations. */
  repoIntel?: RepoIntel;
  /** repo-intel T3 adapters — only the indexer pipeline reads these. */
  depgraph?: DepGraph;
  tokenizer?: Tokenizer;
}

export class Container {
  readonly config: AppConfig;
  readonly db: Db;
  readonly secrets: SecretsProvider;
  readonly auth: AuthProvider;
  readonly jobs: JobRunner;
  readonly runBus: RunBus;

  private _git?: GitClient;
  private _github?: GitHubClient;
  private _codeIndex?: CodeIndex;
  private _embedder?: Embedder;
  private llmCache = new Map<string, LLMProvider>();

  // Shared repositories for cross-cutting entities (agents, reviews/pulls,
  // runs). Constructed here, in the composition root, so consuming modules use
  // `container.agentsRepo` instead of reaching into another module's folder.
  private _agentsRepo?: AgentsRepository;
  private _skillsRepo?: SkillsRepository;
  private _skillsService?: SkillsService;
  private _reviewRepo?: ReviewRepository;
  private _repoRepo?: RepoRepository;
  private _projectContextRepo?: ProjectContextRepository;
  private _projectContextService?: ProjectContextService;
  private _onboardingRepo?: OnboardingRepository;
  private _onboardingService?: OnboardingService;
  private _briefRepo?: BriefRepository;
  private _briefService?: BriefService;
  private _evalRepo?: EvalRepository;
  private _evalService?: EvalService;
  private _repoIntel?: RepoIntel;
  private _depgraph?: DepGraph;
  private _tokenizer?: Tokenizer;
  private _priceBook?: PriceBook;
  private _intentRepo?: IntentRepository;
  private _intentService?: IntentService;
  private _memoryRepo?: MemoryRepository;
  private _ciRepo?: CiRepository;
  private _ciService?: CiService;

  constructor(config: AppConfig, db: Db, private overrides: ContainerOverrides = {}) {
    this.config = config;
    this.db = db;
    this.secrets = overrides.secrets ?? new LocalSecretsProvider(config.secretsPath);
    this.auth = overrides.auth ?? new LocalNoAuthProvider(db);
    this.runBus = runBus;
    this.jobs = new JobRunner(db);
  }

  get git(): GitClient {
    if (this.overrides.git) return this.overrides.git;
    this._git ??= new SimpleGitClient(this.config.cloneDir);
    return this._git;
  }

  get agentsRepo(): AgentsRepository {
    return (this._agentsRepo ??= new AgentsRepository(this.db));
  }

  /** Skills, skill_versions and run_skills. Shared: the skills module reads and
   *  writes it, the run executor writes `run_skills` at prompt-assembly time. */
  get skillsRepo(): SkillsRepository {
    return (this._skillsRepo ??= new SkillsRepository(this.db));
  }

  /** Application service over `skillsRepo` — shared so a consuming module
   *  (e.g. conventions, merging accepted candidates into a skill) never has to
   *  import `modules/skills/service.ts` directly. */
  get skillsService(): SkillsService {
    return (this._skillsService ??= new SkillsService(
      this.skillsRepo,
      this.tokenizer,
      this.projectContextService,
      this.evalRepo,
    ));
  }

  get reviewRepo(): ReviewRepository {
    return (this._reviewRepo ??= new ReviewRepository(this.db));
  }

  get repoRepo(): RepoRepository {
    return (this._repoRepo ??= new RepoRepository(this.db));
  }

  /** specs/09-project-context-folder.md — `agent_context_docs` /
   *  `skill_context_docs` + the per-repo `doc_roots` override. */
  get projectContextRepo(): ProjectContextRepository {
    return (this._projectContextRepo ??= new ProjectContextRepository(this.db));
  }

  /**
   * Application service for the Project Context Folder feature — discovery,
   * attachment CRUD, and run-time resolution (merge → dedupe → budget →
   * read). Shared getter (same shape as `skillsService`) so `reviews/
   * run-executor.ts`, `reviews/adhoc.ts` and `skills/service.ts` never import
   * `modules/project-context/*` directly (`no-cross-module`).
   */
  get projectContextService(): ProjectContextService {
    return (this._projectContextService ??= new ProjectContextService(
      this.projectContextRepo,
      this.agentsRepo,
      this.skillsRepo,
      this.agentsRepo,
      this.tokenizer,
    ));
  }

  /** specs/10-onboarding-generator.md — the `onboarding` table (one row per
   *  repo, the current tour). */
  get onboardingRepo(): OnboardingRepository {
    return (this._onboardingRepo ??= new OnboardingRepository(this.db));
  }

  /**
   * Application service for the Onboarding Generator — `getPage` (0 LLM
   * calls) and `generate` (the one structured call per generation). Shared
   * getter (`projectContextService`'s shape) so `routes.ts` reads
   * `container.onboardingService` rather than constructing a new instance
   * per request — the in-flight generation guard (AC-20) only works because
   * this is a process-wide singleton.
   */
  get onboardingService(): OnboardingService {
    return (this._onboardingService ??= new OnboardingService(
      this.onboardingRepo,
      this.repoRepo,
      this.repoIntel,
      (workspaceId, id) => this.resolveFeatureModel(workspaceId, id),
      (id) => this.llm(id),
      this.tokenizer,
      (model, tokensIn, tokensOut) => this.priceBook.estimate(model, tokensIn, tokensOut),
      // No Fastify `app.log` reaches the container (composition-root
      // boundary) — `console` is pino-compatible enough for the one
      // structured `.info(obj, msg)` line this service emits per generation.
      console,
    ));
  }

  /** specs/11-why-risk-brief.md — the `pr_brief` table (one row per PR, the
   *  current stored brief). */
  get briefRepo(): BriefRepository {
    return (this._briefRepo ??= new BriefRepository(this.db));
  }

  /**
   * Application service for the PR Why + Risk Brief — `getPage` (0 LLM
   * calls) and `generate` (the one structured call per generation). Shared
   * getter (`onboardingService`'s shape) so `routes.ts` reads
   * `container.briefService` rather than constructing a new instance per
   * request — the in-flight generation guard (AC-27) only works because this
   * is a process-wide singleton.
   */
  get briefService(): BriefService {
    return (this._briefService ??= new BriefService(
      this.briefRepo,
      this.repoIntel,
      (workspaceId, id) => this.resolveFeatureModel(workspaceId, id),
      (id) => this.llm(id),
      () => this.github(),
      readSpecFile,
      this.tokenizer,
      (model, tokensIn, tokensOut) => this.priceBook.estimate(model, tokensIn, tokensOut),
      console,
    ));
  }

  /** specs/12-eval-pipeline.md (L06) — the `eval_cases`/`eval_runs` tables,
   *  reshaped in place (D1). Also satisfies D18's cascade port structurally
   *  (`deleteForOwner`) — wired directly into `AgentsService` at
   *  `modules/agents/routes.ts`, no `evalService` involved. */
  get evalRepo(): EvalRepository {
    return (this._evalRepo ??= new EvalRepository(this.db));
  }

  /**
   * Application service for the Eval Pipeline — case CRUD, run lifecycle,
   * dashboard/detail/compare assembly, stale-run reconciliation. Shared
   * getter (`briefService`'s shape) so `routes.ts` reads
   * `container.evalService` rather than constructing a new instance per
   * request, and `server.ts`'s boot-time reconcile call
   * (`evalService.reconcileStaleRuns()`) hits the same repository the
   * routes use.
   */
  get evalService(): EvalService {
    return (this._evalService ??= new EvalService(
      this.evalRepo,
      this.agentsRepo,
      this.agentsRepo,
      (id) => this.llm(id),
      (model, tokensIn, tokensOut) => this.priceBook.estimate(model, tokensIn, tokensOut),
      console,
      new EvalExecutor(),
      // specs/15-skill-eval-cases.md §5/§8 — `AgentsRepository.linkedSkills`
      // adapted to the flat `LinkedSkillForRun` shape the arm-assembly
      // helper needs (id/name/type/body + order + BOTH gate states), the
      // same adaptation shape `ciService`'s `enabledSkills` port already uses.
      {
        linkedSkills: (agentId: string) =>
          this.agentsRepo.linkedSkills(agentId).then((rows) =>
            rows.map((r) => ({
              id: r.skill.id,
              name: r.skill.name,
              type: r.skill.type,
              body: r.skill.body,
              order: r.order,
              linkEnabled: r.enabled,
              skillEnabled: r.skill.enabled,
            })),
          ),
      },
      this.tokenizer,
    ));
  }

  get intentRepo(): IntentRepository {
    return (this._intentRepo ??= new IntentRepository(this.db));
  }

  /**
   * L03 — PR intent resolution (signals → one structured LLM call → cached on
   * `pull_requests`). Shared getter so `reviews/run-executor.ts` never
   * imports `modules/intent/*` directly (dependency-cruiser's
   * `no-cross-module`) — it only ever calls `container.intentService.resolve(...)`,
   * the same composition-root pattern `skillsService` already establishes.
   */
  get intentService(): IntentService {
    return (this._intentService ??= new IntentService(
      this.intentRepo,
      (workspaceId, id) => this.resolveFeatureModel(workspaceId, id),
      (id) => this.llm(id),
      () => this.github(),
      readClone,
    ));
  }

  /** Per-feature model choice (workspace override, else registry default) —
   *  shared so callers outside `modules/settings` never import
   *  `feature-models.ts` directly. */
  resolveFeatureModel(workspaceId: string, id: FeatureModelId): Promise<FeatureModelChoice> {
    return resolveFeatureModelForWorkspace(this.db, workspaceId, id);
  }

  /** specs/14-export-to-ci.md (D-P4) — the `memory` table's read side, ahead
   *  of the sibling `feat/multi-agent-review`'s write side merging first.
   *  Registers no route of its own (see `modules/memory/repository.ts`). */
  get memoryRepo(): MemoryRepository {
    return (this._memoryRepo ??= new MemoryRepository(this.db));
  }

  /** specs/14-export-to-ci.md — `ci_installations`/`ci_runs` + the CI-sourced
   *  `agent_runs`/`run_traces` writes (D7) + Agent Performance aggregation. */
  get ciRepo(): CiRepository {
    return (this._ciRepo ??= new CiRepository(this.db));
  }

  /**
   * Application service for Export to CI — bundle generation/export/ingest
   * orchestration. Ports are wired here, at the composition root: `agentsRepo`
   * satisfies `AgentLookup` structurally; `enabledSkills` is adapted from
   * `{id,name,type,body}[]` to `{slug,body}[]` (a skill's `name` column IS
   * its slug) since the port's field name differs from the row's; `memoryRepo`
   * satisfies `MemoryReader` and `repoRepo` satisfies `RepoLookup` directly.
   */
  get ciService(): CiService {
    return (this._ciService ??= new CiService(
      this.ciRepo,
      this.agentsRepo,
      {
        enabledSkills: (agentId: string) =>
          this.agentsRepo.enabledSkills(agentId).then((rows) =>
            rows.map((r) => ({ slug: r.name, body: r.body })),
          ),
      },
      this.memoryRepo,
      this.repoRepo,
      () => this.github(),
      this.config.ciRunnerBundleDir,
      this.secrets,
    ));
  }

  get codeIndex(): CodeIndex {
    if (this.overrides.codeIndex) return this.overrides.codeIndex;
    this._codeIndex ??= new RipgrepCodeIndex(this.git);
    return this._codeIndex;
  }

  /**
   * The repo-intel facade (T1.1). All higher-level features (reviews,
   * blast/onboarding migrations, phantom-gate) code against this interface.
   * Tests inject a mock via `ContainerOverrides.repoIntel`.
   */
  get repoIntel(): RepoIntel {
    if (this.overrides.repoIntel) return this.overrides.repoIntel;
    this._repoIntel ??= new RepoIntelService(this);
    return this._repoIntel;
  }

  /** Import-graph builder (dependency-cruiser). T3 indexer pipeline only. */
  get depgraph(): DepGraph {
    if (this.overrides.depgraph) return this.overrides.depgraph;
    this._depgraph ??= new DepCruiseGraph();
    return this._depgraph;
  }

  /** Token counter (js-tiktoken) for the repo-map budget search. */
  get tokenizer(): Tokenizer {
    if (this.overrides.tokenizer) return this.overrides.tokenizer;
    this._tokenizer ??= new TiktokenTokenizer();
    return this._tokenizer;
  }

  /**
   * Live OpenRouter pricing for cost attribution. The lister builds a bare
   * OpenRouter provider just for `/models` (no estimator needed) and degrades to
   * `[]` when no key is configured; the static `estimateCost` table is the
   * fallback for OpenAI/Anthropic and a cold/cold-failed cache.
   */
  get priceBook(): PriceBook {
    this._priceBook ??= new PriceBook(async () => {
      try {
        const key = await this.secrets.get('OPENROUTER_API_KEY');
        if (!key) return [];
        return await new OpenRouterProvider(key).listModels();
      } catch {
        return [];
      }
    }, estimateCost);
    return this._priceBook;
  }

  async github(): Promise<GitHubClient> {
    if (this.overrides.github) return this.overrides.github;
    if (this._github) return this._github;
    const token = await this.secrets.get('GITHUB_TOKEN');
    if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
    this._github = new OctokitGitHubClient(token);
    return this._github;
  }

  /** Resolve an LLM provider by id; constructs from the secret key, cached. */
  async llm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    const injected = this.overrides.llm?.[id];
    if (injected) return injected;
    const cached = this.llmCache.get(id);
    if (cached) return cached;
    const provider = await this.buildLlm(id);
    this.llmCache.set(id, provider);
    return provider;
  }

  private async buildLlm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    if (id === 'openai') {
      const key = await this.secrets.get('OPENAI_API_KEY');
      if (!key) throw new ConfigError('OPENAI_API_KEY is not configured');
      return new OpenAIProvider(key);
    }
    if (id === 'openrouter') {
      // Single OpenRouter provider lives in reviewer-core (shared with the CI
      // runner); inject the PriceBook so cost attribution uses LIVE OpenRouter
      // prices (with the static table as a fallback) rather than a hardcoded one.
      const key = await this.secrets.get('OPENROUTER_API_KEY');
      if (!key) throw new ConfigError('OPENROUTER_API_KEY is not configured');
      return new OpenRouterProvider(key, {
        estimateCost: (model, tokensIn, tokensOut) =>
          this.priceBook.estimate(model, tokensIn, tokensOut),
      });
    }
    const key = await this.secrets.get('ANTHROPIC_API_KEY');
    if (!key) throw new ConfigError('ANTHROPIC_API_KEY is not configured');
    return new AnthropicProvider(key);
  }

  async embedder(): Promise<Embedder> {
    // Injected embedders (tests) always win. Otherwise embeddings are gated by
    // config: when disabled we throw BEFORE constructing the OpenAI client, so
    // the app makes ZERO OpenAI requests. All callers wrap this in try/catch and
    // degrade gracefully (memory/RAG simply returns no hits).
    if (this.overrides.embedder) return this.overrides.embedder;
    if (!this.config.embeddingsEnabled) {
      throw new ConfigError('Embeddings are disabled (set EMBEDDINGS_ENABLED=true to enable memory/RAG)');
    }
    if (this._embedder) return this._embedder;
    const openai = await this.llm('openai');
    this._embedder = new OpenAIEmbedder(openai);
    return this._embedder;
  }

  /**
   * Drop cached provider clients so the next resolve picks up changed secrets.
   * Call after persisting a new API key/PAT via SecretsProvider.set.
   */
  invalidateSecretCaches(): void {
    this.llmCache.clear();
    this._github = undefined;
    this._embedder = undefined;
  }
}
