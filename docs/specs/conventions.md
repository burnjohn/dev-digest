# Spec — Conventions Extractor (repo → candidates → skill)

Status: **implemented** (2026-08-05) · Scope: `server/` · `client/` · shared contracts
Related: [`skills.md`](skills.md) — the extractor's output is an ordinary skill.

Scan a cloned repository for the **house rules it already follows**, show each one with
the code that proves it, let a maintainer accept / reject / edit them, and merge the
accepted set into a `repo-conventions` skill linked to a reviewing agent.

The feature's whole design premise: **a model is good at noticing a pattern and bad at
remembering where it saw it.** So the model only ever proposes; code chooses what it
reads and code verifies what it claims.

```
repo-intel + config wish-list      ONE cheap structured call        re-read the file
        │                                    │                              │
   ┌────▼─────┐   line-numbered  ┌───────────▼──────────┐   candidates ┌────▼──────┐   pending rows
   │  SAMPLE  ├─────listing─────►│       PROPOSE        ├─────────────►│  VERIFY   ├──────────────►
   │  (code)  │                  │       (model)        │              │  (code)   │
   └──────────┘                  └──────────────────────┘              └───────────┘
```

---

## 1. Decisions taken

| # | Decision | Consequence |
|---|----------|-------------|
| D1 | Sampling is **100 % code**, never a model call | deterministic cost, reproducible scan; the model cannot browse or choose files |
| D2 | The evidence gate is **code, not a second model** | a candidate whose snippet is not in the cited file is *dropped*, not "low-confidence" |
| D3 | The displayed snippet is **re-read from the file**, not the model's text | the UI cannot show a paraphrase as if it were code |
| D4 | A wrong line number is **corrected**, not fatal | miscounting is a formatting slip; inventing code is not |
| D5 | Triage is a three-state `status`, not a boolean | a re-scan replaces only `pending`, so a rejected rule never comes back |
| D6 | The skill is a **draft** (`POST …/conventions/skill`), persisted only via `POST /skills` | same preview-then-confirm flow as skill import; the user edits everything before it exists |
| D7 | The scan reports `proposed` / `dropped_ungrounded` / `dropped_duplicate` | 3 candidates out of 12 proposed reads as "the gate worked", not "the feature is broken" |
| D8 | The model comes from `FEATURE_MODELS.conventions` (Settings → Feature Models) | picking a cheap model is a user setting, not a hardcoded constant |

---

## 2. What already existed (do not rebuild)

The starter shipped most of the scaffolding and stopped before the module and the UI.

| Layer | Already there | File |
|-------|---------------|------|
| DB | `conventions` table (rule / evidence / confidence) | `server/src/db/schema/knowledge.ts` |
| Contracts | `ConventionCandidate` | `server/src/vendor/shared/contracts/knowledge.ts` |
| Sampling | `repoIntel.getConventionSamples(repoId, n)` — top-ranked files minus tests/configs/migrations | `server/src/modules/repo-intel/service.ts:630` |
| Model config | `FEATURE_MODELS` entry `conventions` + `resolveFeatureModel` | `.../contracts/platform.ts:73`, `modules/settings/feature-models.ts` |
| i18n | most of the `conventions` namespace (page, empty state, card) | `client/messages/en/conventions.json` |
| Routing | `activeKeyFor()` already maps `/conventions` | `client/src/components/app-shell/helpers.ts:31` |
| Test seam | `MockLLMOptions.structuredBySchema` names this feature's schema | `server/src/adapters/mocks.ts:46-52` |

---

## 3. Data model

Migration `0015_same_gargoyle.sql` (generated) extends `conventions`:

| Column | Why |
|--------|-----|
| `category` | grouping chip + skill section; CHECK-constrained to the 8 contract values |
| `rationale` | one sentence on what a reviewer should flag; editable, nullable |
| `evidence_line` | 1-based, **as verified by code**, not as claimed by the model |
| `status` | `pending` / `accepted` / `rejected`, CHECK-constrained (replaces the old `accepted` boolean) |
| `created_at` | ordering; part of `conventions_repo_created_idx` |

`text({ enum })` narrows TypeScript only, so both enums are mirrored into Postgres as
`CHECK` constraints — the same rule the review pipeline's columns follow.

---

## 4. Contracts

`ConventionCategory`, `ConventionStatus`, an extended `ConventionCandidate`, plus
`ConventionExtractResult` (candidates + the scan counters + model + cost) and
`ConventionSkillDraft` (the un-persisted skill). Canonical copy in
`server/src/vendor/shared/`, hand-ported to `client/src/vendor/shared/`.

---

## 5. Server — `src/modules/conventions/`

| File | Holds |
|------|-------|
| `constants.ts` | sample sizes, per-file and whole-sample caps, gate thresholds |
| `prompt.ts` | `ExtractionSchema` (`schemaName: 'ConventionExtraction'`) + the system prompt |
| `helpers.ts` | pure: sample rendering, the evidence gate, dedupe, DTO, skill assembly |
| `repository.ts` | `conventions` table only; `replacePending` keeps decided rows |
| `service.ts` | the three stages |
| `routes.ts` | the five endpoints |

```
GET    /repos/:id/conventions          → candidates for the repo
POST   /repos/:id/conventions/extract  → scan (one model call)
POST   /repos/:id/conventions/skill    → skill DRAFT from accepted (writes nothing)
PATCH  /conventions/:id                → accept / reject / edit rule + rationale
DELETE /conventions/:id                → drop a candidate
```

### 5.1 Sampling (stage 1, no model)

`CONFIG_SAMPLE_PATHS` (package.json, tsconfig, eslint/prettier/editorconfig, biome,
CONTRIBUTING/CLAUDE/AGENTS.md) — missing ones are skipped silently — followed by
`repoIntel.getConventionSamples(repoId, 12)`. Each file is truncated to 220 lines /
12 000 chars, and the whole sample to 90 000 chars. Every file is rendered with a
**1-based line-number gutter**; that gutter is what makes a citation checkable. A repo
with nothing readable 422s with "clone and index it first" — before any model call.

### 5.2 Proposal (stage 2, the only model call)

One `completeStructured` at `temperature 0.1`. The system prompt states what counts as
a house rule, lists the anti-patterns to *not* return (universal advice, framework
requirements, single-trivial-line evidence), defines each category, fixes the
confidence bands, caps the answer at 12, and says outright that an ungrounded
candidate will be discarded.

**Schema field order is load-bearing.** `category` and `confidence` come *after*
`rule` and the evidence, and a self-reported `occurrences` count comes before the
score. Measured on a live scan of `angular-osf` (deepseek-v4-flash, same sample):

| Field order | Categories used | Confidence spread |
|---|---|---|
| `category` first | 1 of 8 (`imports` for all 12) | 0.90 for all 12 |
| `category` last, after `occurrences` | 5 of 8 | 0.50 – 0.95 |

The model commits to a label before it knows what it is about to say, so anything it
must *judge* belongs after everything it must *observe*.

### 5.3 The evidence gate (stage 3, no model)

`verifyCandidate()` — three checks, all mechanical:

1. **Path was sampled.** Exact match, or a *unique* suffix match (`./src/a.ts`, `a.ts`).
   Ambiguity is not resolved — guessing would defeat the gate.
2. **Snippet is substantial** (≥ 8 non-space chars) — `}` identifies nothing.
3. **Snippet is in the file.** Whitespace/case-insensitive; the hit nearest the claimed
   line wins, so a repeated line resolves to the one meant. No hit → dropped.

The kept snippet is sliced **from the file** and dedented. Then candidates are sorted
by confidence and deduped against each other *and* against every rule the user has
already accepted or rejected.

---

## 6. Client

| Path | What |
|------|------|
| `src/lib/hooks/conventions.ts` | list / extract / patch / delete / draft. Extract is a **mutation** (it costs a model call) and seeds the list cache from its response |
| `src/app/repos/[repoId]/conventions/page.tsx` | scan button, scan summary, triage filter chips, card list, Create-skill |
| `.../_components/ConventionCard` | rule, category, evidence `file:line` + snippet, confidence bar, accept / reject / edit / delete |
| `.../_components/CreateSkillModal` | editable name, description, type, enabled, body, optional agent link |
| `src/lib/hooks/skills.ts` | new `useLinkAgentSkill` — the *additive* form; `useSetAgentSkills` replaces the whole set and would wipe an agent's other skills |
| `src/vendor/ui/nav.ts` | `Conventions` under SKILLS LAB (`g c`) — the sanctioned vendor edit |

---

## 7. Testing

| Lane | File | Covers |
|------|------|--------|
| server unit | `test/conventions-helpers.test.ts` | 21 cases: gutter rendering, budget cut-off, every gate outcome, line correction, ambiguous path, dedupe, skill body |
| server integration | `test/conventions.it.test.ts` | scan drops the invented candidate, re-scan preserves decisions, edit → draft → `POST /skills`, 422 on unsampleable repo and on nothing-accepted |
| client unit | `helpers.test.ts`, `ConventionCard.test.tsx`, `page.test.tsx` | filtering/counting, card interactions, scan summary, modal gating |

Verified live once against `CenterForOpenScience/angular-osf` (17 sampled files,
deepseek-v4-flash via OpenRouter, ~$0.001/scan, ~50 s): 13 proposed, 2 dropped by the
evidence gate, 11 kept — including `osf`-prefixed selectors, the `simple-import-sort`
group order, the `@osf/`/`@core/`/`@shared/` aliases and the `AsyncStateModel<T>` state
shape. Those are real house rules a generic reviewer would not know.

---

## 8. Roadmap — how to get more findings, and better ones

The gate is deliberately strict, so quality work means **feeding it more real signal**,
not loosening it.

**Better input**
1. **Git history as evidence.** Mine review comments and repeated fix-up commits (`git
   log -p` on files with high churn): a rule someone has *already asked for twice* in
   review is the strongest possible candidate, and DevDigest's own findings table is a
   second source of the same signal.
2. **Sample by diversity, not only by rank.** Today the top-12 are the most central
   files, which are often the same layer. Bucket by directory / file kind (route,
   service, repository, component, test) and take the top-N *per bucket* — one pass
   over the same budget surfaces layer-specific conventions the current sample cannot see.
3. **Include the tests.** `getConventionSamples` filters tests out (right for review
   context, wrong here): testing conventions are among the most useful rules and are
   invisible in the current sample.
4. **Two-step dialogue.** The mock adapter already anticipates a
   `ConventionFileSelection` call before `ConventionExtraction`: let the model pick 12
   files *from a code-built candidate list of 100 paths*. It never browses; it only
   ranks. Cheap, and it targets the sample at what looks conventional.

**Better verification**
5. **Frequency as the confidence signal.** After extraction, `ripgrep` the rule's shape
   across the whole repo (the `CodeIndex` adapter is already wired): a pattern in 40
   files is a convention, the same pattern in 1 file is a coincidence. Show
   "42 occurrences" instead of the model's self-reported confidence — it is the single
   highest-leverage upgrade on this list.
6. **Counter-example search.** Report violations too ("this holds in 38 files, 3 break
   it"), which both grades the rule and gives the user a ready-made cleanup task.
7. **Contradiction check against existing skills.** Warn before a new rule lands that
   contradicts one already in the Skills Lab.

**Better loop**
8. **Learn from rejections.** Rejected rules are labelled negatives — feed their text
   into the next scan's prompt as "the maintainer has already dismissed these".
9. **Scan on a schedule / on merge**, diffing against the last scan, so conventions
   drift with the codebase instead of being a one-off.
10. **Close the loop through review outcomes.** A convention whose skill produces
    findings that keep getting dismissed is a bad rule; the eval dashboard already has
    the shape to measure that.
