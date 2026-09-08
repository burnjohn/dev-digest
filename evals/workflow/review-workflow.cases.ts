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
    name: "API-route task reads server/README (API map) AND pulls the architecture-reviewer",
    prompt:
      "Я планую додати НОВИЙ, ще не реалізований ендпоінт GET /reviews/:id/export (віддає ревʼю як " +
      "markdown). Спершу відкрий server/CLAUDE.md, знайди ТАМ, де описано API map цього модуля, і " +
      "прочитай САМЕ ТОЙ файл (не зупиняйся на CLAUDE.md). Потім ОБОВʼЯЗКОВО запусти сабагента " +
      "architecture-reviewer, щоб він оцінив мій план на відповідність onion-шарам — не рецензуй сам.",
    // server/CLAUDE.md's own opening line routes this exactly: "Stack, DI flow
    // diagram, API map, env table: README.md" — there is no
    // server/docs/api-contracts.md in this repo (that path only ever existed on
    // the separate, never-merged upstream/lesson-3-lab/intent-layer-start
    // branch). Fixed 2026-09-08 after this case failed CI expecting a file the
    // repo has never actually had; the first replacement attempt
    // (docs/architecture.md) proved non-deterministic across reruns — the
    // model sometimes dove straight into source instead, so the prompt now
    // explicitly names the routing step, same fix shape as the pipeline case
    // below.
    expectFilesRead: ["server/README.md"],
    expectSubagents: ["architecture-reviewer"],
    maxTurns: 8,
  },

  // --- trace (1 session): two "Read When" rows at once -----------------------------------------
  {
    kind: "trace",
    // Tests the CLAUDE.md "Read When" routing, so the prompt must push toward CONSULTING the docs,
    // not exploring source. Earlier phrasing ("розберись, як усе влаштовано") sent the model straight
    // into schema.ts / pipeline.run.ts and it never opened the routed doc. One anchor doc keeps this a
    // deterministic routing check — asserting two docs in one session is inherently flaky.
    // reviewer-core/CLAUDE.md's own opening line routes this exactly: "Pipeline
    // diagram, public API: README.md" — there is no reviewer-core/docs/pipeline.md
    // in this repo (only on the separate, never-merged
    // upstream/lesson-3-lab/intent-layer-start branch). Fixed 2026-09-08 after
    // this case failed CI expecting a file the repo has never actually had.
    name: "pipeline task follows CLAUDE.md routing to reviewer-core/README.md",
    prompt:
      "Я збираюся змінити review pipeline у модулі reviewer-core (LLM-рев'ю). Перш ніж торкатися коду — " +
      "відкрий reviewer-core/CLAUDE.md, знайди ТАМ рядок, який каже, де описано pipeline diagram і " +
      "public API цього модуля, і прочитай САМЕ ТОЙ файл, на який він вказує (не зупиняйся на CLAUDE.md).",
    expectFilesRead: ["reviewer-core/README.md"],
    maxTurns: 8,
  },

  // --- trace (1 session): CLAUDE.md "Hit unexpected behavior" routing -> LEARNINGS ---------------
  // Was a contrast case, but the control run (empty tmpdir) could still reach the real repo by
  // absolute path and read the routed doc, making the negative flaky. As a single-session trace it
  // reliably checks the same routing rule: in the real repo, the discovery prompt reads that doc.
  // root CLAUDE.md is explicit: "Read the LEARNINGS.md of the module you're
  // about to work in before you start" — reviewer-core/CLAUDE.md repeats it
  // ("Read LEARNINGS.md before starting work here"). There is no
  // reviewer-core/insights/gotchas.md in this repo (only on the separate,
  // never-merged upstream/lesson-3-lab/intent-layer-start branch); gotchas
  // for this module live inline in reviewer-core/CLAUDE.md's own "Gotchas"
  // section, and non-obvious discoveries land in LEARNINGS.md. Fixed
  // 2026-09-08 after this case failed CI expecting a file the repo has never
  // actually had.
  {
    kind: "trace",
    name: "CLAUDE.md routes a gotchas lookup to reviewer-core/LEARNINGS.md",
    prompt:
      "У reviewer-core я стикнувся з несподіваною поведінкою — щось працює не так, як я очікував. " +
      "За настановами цього репо, де це вже могло бути задокументовано? Прочитай той файл.",
    expectFilesRead: ["reviewer-core/LEARNINGS.md"],
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
