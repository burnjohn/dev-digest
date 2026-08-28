import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md + skills + subagents,
 * loaded via settingSources:["project"]) behaves as documented. Organized by scenario, not by a
 * single artifact, because these behaviors are cross-cutting.
 *
 * Budget: 12 Claude sessions total.
 *   - 10 × trace/dispatch → 1 session each                 = 10
 *   - 1 × activation pair (positive + near-miss negative)  = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — so a dispatch-bearing trace never waits out the nested subagent's full run.
 * Cases below fold in a doc-read wherever one naturally accompanies the routing decision being
 * tested (client/server module conventions, module INSIGHTS.md, a feature spec) — merged only
 * where a single realistic prompt would plausibly trigger both facts; kept separate (`dispatch`)
 * where forcing two routing decisions into one prompt would just be a frankenstein ask.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): CLAUDE.md "Read When" routing + subagent dispatch, together -----------
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
    // Target is server/AGENTS.md, not a docs/api-contracts.md — that path never existed in this
    // repo (it was evals/README.md's illustrative example, copied here by mistake; verified via
    // `ls server/docs/` — only README.md lives there). AGENTS.md's "Non-default conventions" is
    // where the schema-first Zod-validation rule actually lives, and it's what the model reads.
    name: "API-route task reads api-contracts AND pulls the architecture-reviewer",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Спершу звірся з конвенціями API цього репо. Потім ОБОВʼЯЗКОВО запусти сабагента " +
      "architecture-reviewer, щоб він оцінив мій план на відповідність onion-шарам — не рецензуй сам.",
    expectFilesRead: ["server/AGENTS.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // --- trace (1 session): two "Read When" rows at once -----------------------------------------
  {
    kind: "trace",
    // Tests the CLAUDE.md "Read When" routing, so the prompt must push toward CONSULTING the docs,
    // not exploring source. Earlier phrasing ("розберись, як усе влаштовано") sent the model straight
    // into schema.ts / pipeline.run.ts and it never opened the routed doc. One anchor doc (pipeline.md)
    // keeps this a deterministic routing check — asserting two docs in one session is inherently flaky.
    name: "pipeline task follows CLAUDE.md routing to pipeline.md",
    prompt:
      "Я збираюся змінити review pipeline. Перш ніж торкатися коду — звірся з настановами цього репо " +
      "(CLAUDE.md) щодо того, яку документацію треба прочитати для змін у pipeline, і прочитай саме ці документи.",
    expectFilesRead: ["reviewer-core/docs/pipeline.md"],
    maxTurns: 8,
  },

  // --- trace (1 session): CLAUDE.md "Hit unexpected behavior" routing -> gotchas ----------------
  // Was a contrast case, but the control run (empty tmpdir) could still reach the real repo by
  // absolute path and read gotchas.md, making the negative flaky. As a single-session trace it
  // reliably checks the same routing rule: in the real repo, the discovery prompt reads gotchas.md.
  {
    kind: "trace",
    name: "CLAUDE.md routes a gotchas lookup to reviewer-core/insights",
    prompt:
      "У reviewer-core я стикнувся з несподіваною поведінкою — щось працює не так, як я очікував. " +
      "За настановами цього репо, де це вже могло бути задокументовано? Прочитай той файл.",
    expectFilesRead: ["reviewer-core/insights/gotchas.md"],
    maxTurns: 5,
  },

  // --- trace (1 session): client/AGENTS.md conventions + client/INSIGHTS.md + frontend review ---
  {
    kind: "trace",
    // Component must be new/hypothetical, or the model reviews existing code inline. Naming the
    // anti-pattern ("fetch у компоненті") in the prompt is what forces a conventions check instead
    // of the model just inventing its own approach.
    name: "new client component task reads client/AGENTS.md AND client/INSIGHTS.md, pulls architecture-reviewer",
    prompt:
      "Я планую додати НОВИЙ клієнтський компонент, який сам робить fetch до API просто з UI (ще не " +
      "реалізований). Спершу звірся з конвенціями пакету client щодо роботи з даними, і перевір, чи " +
      "немає вже задокументованих готчів у client/INSIGHTS.md. Потім ОБОВʼЯЗКОВО запусти сабагента " +
      "architecture-reviewer, щоб він оцінив мій план — не рецензуй сам.",
    expectFilesRead: ["client/AGENTS.md", "client/INSIGHTS.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // --- trace (1 session): server/AGENTS.md + smart-diff spec + server/INSIGHTS.md, together ------
  {
    kind: "trace",
    name: "new server module task reads server/AGENTS.md, the smart-diff spec, AND server/INSIGHTS.md",
    prompt:
      "Хочу додати новий server-модуль, що впроваджує групування findings за файлами — щось на " +
      "кшталт вже наявного smart-diff. Спершу звірся з конвенціями реєстрації модулів у server " +
      "(AGENTS.md), прочитай специфікацію smart-diff, і перевір server/INSIGHTS.md на предмет " +
      "готчів, перш ніж я почну писати код.",
    expectFilesRead: ["server/AGENTS.md", "server/specs/smart-diff.md", "server/INSIGHTS.md"],
    maxTurns: 8,
  },

  // --- dispatch (1 session): Delegation table — spec-creator for a feature with no spec yet ------
  {
    kind: "dispatch",
    // The feature must be genuinely spec-less, or the model may just draft the spec inline instead
    // of dispatching (same "must not already exist" constraint as the API-route case above).
    name: "greenfield feature request dispatches spec-creator instead of drafting inline",
    prompt:
      "Хочу специфікацію для нової фічі — email-сповіщення про PR Risk Brief (її ще немає в " +
      "кодовій базі, ніде не описана). Потрібні EARS-критерії прийняття. Використай відповідного " +
      "спеціаліста з .claude/agents — не пиши специфікацію сам.",
    expectSubagent: "spec-creator",
    maxTurns: 6,
  },

  // --- trace (1 session): TESTING.md routing + Delegation table — test-writer ---------------------
  {
    kind: "trace",
    name: "coverage-gap request reads TESTING.md AND dispatches test-writer",
    prompt:
      "Модуль server/src/modules/reviews вже реалізований, але я не певен, що всі гілки покриті " +
      "тестами. Спершу звірся з TESTING.md щодо того, як тут організовано тестування (unit vs " +
      "integration), а потім залучи відповідного спеціаліста, щоб він написав тести — не пиши їх сам.",
    expectFilesRead: ["TESTING.md"],
    expectSubagents: ["test-writer"],
    maxTurns: 8,
  },

  // --- dispatch (1 session): Delegation table — doc-writer for something already shipped ----------
  {
    kind: "dispatch",
    name: "already-shipped feature request dispatches doc-writer instead of writing docs inline",
    prompt:
      "Фіча PR Risk Brief вже реалізована в server/ (один грaунджений виклик моделі на PR, " +
      "кешується на pr_brief). Хочу, щоб хтось написав design-нотатку про неї в docs/. Використай " +
      "відповідного спеціаліста — не пиши документацію сам.",
    expectSubagent: "doc-writer",
    maxTurns: 6,
  },

  // --- trace (1 session): docs/agent-prompts routing + Delegation table — researcher --------------
  {
    kind: "trace",
    name: "reviewer prompt-tuning task reads docs/agent-prompts AND dispatches researcher",
    prompt:
      "Хочу підкрутити системний промпт агента architecture-reviewer. Перш ніж щось міняти — звірся " +
      "з нашими напрацюваннями щодо авторства промптів рев'юер-агентів і вибору моделі. Потім " +
      "залучи спеціаліста, щоб він знайшов в інтернеті сучасні практики написання system-промптів " +
      "для LLM-агентів код-рев'ю — не гугли сам.",
    expectFilesRead: ["docs/agent-prompts"],
    expectSubagents: ["researcher"],
    maxTurns: 8,
  },

  // --- trace (1 session): mcp spec routing + re-check via architecture-reviewer -------------------
  {
    kind: "trace",
    name: "mcp ring-violation question reads mcp/specs/mcp-server.md AND pulls architecture-reviewer",
    prompt:
      "У mcp/ архітектурний рев'ю виявив порушення ring-моделі — модуль з resolve/ намагався " +
      "імпортувати щось із api/. Де в репозиторії це задокументовано — прочитай той файл. Після " +
      "того як я виправлю імпорт, ОБОВʼЯЗКОВО залучи architecture-reviewer, щоб перевірити " +
      "виправлення — не перевіряй сам.",
    expectFilesRead: ["mcp/specs/mcp-server.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // --- activation pair (2 sessions): positive + near-miss negative ------------------------------
  {
    kind: "activation",
    name: "engineering-insights activates on a genuine discovery",
    prompt:
      "Щойно з'ясував, чому pgvector-запит повертав нуль рядків — розмірність колонки не збіглася " +
      "після зміни моделі ембедингів. Хочу це зафіксувати, щоб більше не наступати.",
    skill: "engineering-insights",
    shouldActivate: true,
    maxTurns: 4,
  },
  {
    kind: "activation",
    name: "near-miss negative — explaining the same topic must NOT record an insight",
    prompt:
      "Поясни, як у pgvector працюють розмірності колонок і чому невідповідність повертає нуль рядків.",
    skill: "engineering-insights",
    shouldActivate: false,
    maxTurns: 4,
  },
];
