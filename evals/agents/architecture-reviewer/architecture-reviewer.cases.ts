import type { AgentCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

const fx = fixtureReader(import.meta.url);

const REVIEW_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("checkout-service.diff")}`;

// A second real diff whose violations map onto DevDigest-SPECIFIC rule names
// (`reviewer-core-zero-io`, `reviewer-core-ground-findings-gate`) that a competent model will
// describe in prose but will not spontaneously name unless the agent forces a citation. This is
// the discriminating case for the strict-vs-lite A/B: both variants should FIND both problems,
// but only the strict variant (which keeps the "cite the exact documented rule per finding" hard
// rule) should reliably emit the identifier. The checkout diff's textbook violations don't
// discriminate — the model volunteers `inward-only-dependencies`/`di-discipline` either way.
const REVIEWER_CORE_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("reviewer-core-gate.diff")}`;

// A diff that violates NO documented rule (a pure local-variable rename inside a domain file, no
// new imports, no cross-layer edges). A grounded reviewer should report zero violations. This
// surfaces the COST of relaxing the citation rule: freed from "every finding must name a
// documented contract", the lite variant is more prone to fabricating a judgment/best-practice
// finding where the strict variant stays silent.
const BENIGN_PROMPT = `Audit this diff against DevDigest's documented structural contracts.

${fx("benign-refactor.diff")}`;

// The practices that exist ONLY because the strict variant carries the citation discipline
// ("every finding quotes the violated rule verbatim"). architecture-reviewer-lite has that rule
// removed BY DESIGN, so it is expected to fail exactly these. They stay in lite's practice list —
// the judge still scores them, and that per-practice row IS the A/B signal we are measuring — but
// they are excluded from lite's pass bar by `liteCases` below. Without that, lite could never
// clear threshold 1.0 no matter how well it did the substantive structural work, and a red case
// would say nothing about quality.
const CITE_RULE_CHECKOUT =
  "quotes the exact documented rule sentence it cites for EVERY finding (the import-matrix row text or the DI-discipline wording from `onion-architecture`), not just a paraphrase — the agent has no rule-identifier slugs, only verbatim rule text";
const CITE_RULE_ZERO_IO =
  "quotes the exact documented rule sentence for the fs-import finding (reviewer-core/AGENTS.md's zero-I/O convention) rather than only describing it in prose";
const CITE_RULE_GROUNDING_GATE =
  "quotes the exact documented rule sentence for the skipped-gate finding (reviewer-core/AGENTS.md's grounding-is-mandatory convention) rather than only describing it in prose";

const CITATION_PRACTICES = new Set([CITE_RULE_CHECKOUT, CITE_RULE_ZERO_IO, CITE_RULE_GROUNDING_GATE]);

// Shared across the strict (architecture-reviewer) and relaxed (architecture-reviewer-lite)
// variants so the two agents are graded on the exact same task — the only thing that should
// move between the two runs is whether "cites the specific documented rule" keeps passing.
export const cases: AgentCase[] = [
  {
    name: "flags both violations in the checkout diff with severity and a citable rule",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "flags the domain file (checkout.ts) importing a type from 'fastify' as a violation of the inward-only dependency rule between Domain and Presentation layers",
      "flags the `new PgCheckoutRepository()` call inside service.ts as a violation of DI discipline (concrete adapters/repositories must be constructed only in the composition root / container)",
      CITE_RULE_CHECKOUT,
      "assigns a severity from this agent's three-level scale (CRITICAL/MAJOR/MINOR) to each finding",
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "states an explicit BLOCK/CHANGES/PASS gate verdict on the `**Verdict:**` line, computed from the severities present",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate an architecture finding for the out-of-scope security-shaped change",
    kind: "quality",
    prompt: REVIEW_PROMPT,
    practices: [
      "does not invent an architecture-contract violation for the optional `reply?: FastifyReply` parameter beyond the inward-only-dependencies import issue itself (no runtime bug/security finding fabricated as an architecture rule)",
      "stays scoped to structural/layering/DI findings and does not comment on naming, style, or test coverage",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "cites the DevDigest-specific rule identifier for reviewer-core violations",
    kind: "quality",
    prompt: REVIEWER_CORE_PROMPT,
    practices: [
      "flags the `import { readFileSync } from 'node:fs'` added to reviewer-core/src/pipeline/run.ts as a violation (reviewer-core must do no I/O except the injected LLMProvider)",
      "flags that runPipeline now returns `deduped` directly, skipping the mandatory `groundFindings()` gate before emitting findings",
      CITE_RULE_ZERO_IO,
      CITE_RULE_GROUNDING_GATE,
      "quotes the offending line verbatim as evidence for each finding, not a paraphrase",
      "states an explicit BLOCK/CHANGES/PASS gate verdict on the `**Verdict:**` line, computed from the severities present",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
  {
    name: "does not fabricate a documented-rule violation for a benign rename",
    kind: "quality",
    prompt: BENIGN_PROMPT,
    practices: [
      "reports no violations for the benign rename (or records only `info`-level, non-blocking observations) — it does not invent a critical/high/medium finding",
      "does not fabricate a documented-rule violation where the diff violates none of the checked rules",
      "the final gate verdict is PASS",
    ],
    threshold: 1.0,
    maxTurns: 25,
  },
];

/**
 * The SAME cases, the SAME prompts and the SAME practice list — only the pass bar moves.
 *
 * architecture-reviewer-lite has the citation discipline removed by design, so every practice in
 * CITATION_PRACTICES is a structural miss for it, not a quality signal. Grading it at threshold
 * 1.0 (as the strict variant is graded) makes those cases permanently red and destroys the
 * measurement: a red case would mean "lite is lite", not "lite did the work badly".
 *
 * So lite's bar is "everything a citation-free reviewer can still be held to" — i.e. every
 * non-citation practice must pass. The citation practices stay in the list and stay judged: their
 * per-practice rows are exactly the A/B evidence for what the rule buys, and `pnpm eval:delta`
 * reads them from the records either way.
 */
export const liteCases: AgentCase[] = cases.map((c) => {
  const practices = c.practices ?? [];
  const gradable = practices.filter((p) => !CITATION_PRACTICES.has(p)).length;
  return {
    ...c,
    // score is passed/total over the FULL list, so the bar is the non-citation share of it.
    threshold: practices.length ? gradable / practices.length : (c.threshold ?? 1.0),
  };
});
