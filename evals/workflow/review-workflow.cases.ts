import type { WorkflowCase } from "../src/index.js";

/**
 * Systemic ("workflow") tier — asserts the real on-disk harness (CLAUDE.md + skills + subagents,
 * loaded via settingSources:["project"]) behaves as documented. Organized by scenario, not by a
 * single artifact, because these behaviors are cross-cutting.
 *
 * Budget: 5 Claude sessions total.
 *   - 3 × trace     → 1 session each                      = 3
 *   - 1 × activation pair (positive + near-miss negative) = 2
 *
 * `trace` folds several assertions into ONE session (cheaper, coarser) and stops early once its
 * evidence is in — so a dispatch-bearing trace never waits out the nested subagent's full run.
 */
export const cases: WorkflowCase[] = [
  // --- trace (1 session): CLAUDE.md "Read When" routing + subagent dispatch, together -----------
  {
    kind: "trace",
    // Endpoint must NOT already exist, or the model reviews the existing code inline instead of
    // planning-then-dispatching. GET /reviews/:id/export is genuinely absent from routes.ts.
    name: "API-route task reads api-contracts AND pulls the architecture-reviewer",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Спершу звірся з конвенціями API цього репо. Потім ОБОВʼЯЗКОВО запусти сабагента " +
      "architecture-reviewer, щоб він оцінив мій план на відповідність onion-шарам — не рецензуй сам.",
    expectFilesRead: ["server/docs/api-contracts.md"],
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
    // A softer "Я збираюся змінити pipeline. Перш ніж торкатися коду..." earlier let the model treat
    // the read as conditional on receiving change details first — it asked "what changes exactly?"
    // instead of reading. The task below is now self-contained: read now, nothing else expected.
    name: "pipeline task follows CLAUDE.md routing to pipeline.md",
    prompt:
      "Твоє єдине завдання зараз: за настановами цього репо (CLAUDE.md) визнач, яку документацію " +
      "треба прочитати перед зміною review pipeline, і прочитай саме ці документи. Не став уточнюючих " +
      "питань і не чекай на деталі змін — просто прочитай документацію зараз.",
    expectFilesRead: ["reviewer-core/docs/pipeline.md"],
    maxTurns: 8,
  },

  // --- trace (1 session): CLAUDE.md "Hit unexpected behavior" routing -> insights.md -------------
  // Was a contrast case, but the control run (empty tmpdir) could still reach the real repo by
  // absolute path and read insights.md, making the negative flaky. As a single-session trace it
  // reliably checks the same routing rule: in the real repo, the discovery prompt reads insights.md.
  // NOTE: reviewer-core/AGENTS.md documents gotchas as a flat `insights.md` file (per the
  // engineering-insights skill convention), not an `insights/` directory — the path below must
  // match that, not an invented gotchas.md.
  {
    kind: "trace",
    name: "CLAUDE.md routes a gotchas lookup to reviewer-core/insights",
    prompt:
      "У reviewer-core я стикнувся з несподіваною поведінкою — щось працює не так, як я очікував. " +
      "За настановами цього репо, де це вже могло бути задокументовано? Прочитай той файл.",
    expectFilesRead: ["reviewer-core/insights.md"],
    maxTurns: 5,
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
