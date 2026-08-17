# Routing table — diff paths → skills → review groups

The full map. `SKILL.md` §3 carries the same table; this file adds the group definitions,
the match semantics, and the worked example against the current tree.

## Match semantics

1. **A file may match several rows. Every match activates.** There is no first-match-wins,
   no priority among rows. A file at `client/src/app/repos/[repoId]/pulls/page.tsx` matches
   four rows and is reviewed by four skills, in one FE agent.
2. **A skill with zero matching files is never loaded, never mentioned, and its group is
   never spawned.** Cost is linear in the diff's footprint, not in the size of the catalog.
3. **Skipped skills are still listed in the report**, each with the reason
   `no matching files`. Without that line the reader cannot tell "the backend is clean" from
   "nobody looked at the backend", and that distinction is the entire value of routed review.
4. **SEC and CORRECT are an always-on floor.** They match any change at all. They are what
   stops a diff touching only `scripts/dev.sh` from receiving no review whatsoever.
5. Match against the **new-side** path. For a rename, route on the new path; keep the old
   path only as context for `frontend-ui-architecture`.

## Groups

A group is one subagent. Group membership decides who reviews the file, not what severity
the finding gets.

| Group | Owns | Skills it may load |
|---|---|---|
| **SEC** | vulnerabilities in the change | `security` + built-in `security-review` |
| **CORRECT** | general defect hunting | built-in `code-review` |
| **BE** | server structure and HTTP layer | `onion-architecture`, `fastify-best-practices` |
| **DATA** | persistence and schema | `drizzle-orm-patterns`, `postgresql-table-design` |
| **CONTRACT** | shared types and Zod schemas | `zod`, `typescript-expert` |
| **FE** | client structure, React, Next, a11y | `frontend-ui-architecture`, `next-best-practices`, `react-best-practices`, `web-design-guidelines`, `vercel-react-best-practices` |
| **TEST** | test quality and lane placement | `react-testing-library` |
| **DOCS** | diagrams and prose | `mermaid-diagram` |

Priority order — the dispatch order for phase 3 (there is no file-count cap; a large group is
batched into ~25-file chunks). It decides what gets covered first if a run is cancelled or the
time budget expires:

```
SEC → CORRECT → BE → DATA → CONTRACT → FE → TEST → DOCS
```

Maximum **5 concurrent** subagents. Groups beyond the fifth run in a second wave; if the
budget is exhausted first, the tail groups go unreviewed and the run is `coverage: partial`,
which can never produce a green gate.

## The table

| Glob | Skill | Group |
|---|---|---|
| `server/src/**/*.ts` — except `vendor/shared/**`, `*.test.ts` | `onion-architecture` | BE |
| `server/src/{app,server}.ts`, `server/src/modules/*/routes.ts`, `server/src/modules/_shared/context.ts`, `server/src/platform/**` | `fastify-best-practices` | BE |
| `server/src/db/**`, `server/src/modules/*/repository*.ts`, `server/src/modules/*/repository/*.repo.ts` | `drizzle-orm-patterns` | DATA |
| `server/src/db/schema/**`, `server/src/db/migrations/**/*.sql` | `postgresql-table-design` | DATA |
| `client/src/**` — anything | `frontend-ui-architecture` | FE |
| `client/src/app/**`, `client/next.config.*`, `client/src/lib/api.ts`, `client/src/i18n/**` | `next-best-practices` | FE |
| `client/src/**/*.tsx`, `client/src/lib/hooks/**` | `react-best-practices` | FE |
| `client/src/{app,components,vendor/ui}/**/*.tsx` | `web-design-guidelines`, `vercel-react-best-practices` *(global skills)* | FE |
| `client/src/**/*.test.{ts,tsx}`, `client/src/test/**` | `react-testing-library` | TEST |
| `**/vendor/shared/**`, **or** any file whose added lines contain `from 'zod'` | `zod` | CONTRACT |
| `**/tsconfig*.json`, `**/*.d.ts`, `**/vendor/shared/**`, any file the pre-gate reported a type error in | `typescript-expert` | CONTRACT |
| any `*.{ts,tsx,sql,sh,yml,yaml}` or any `package.json` | `security` + built-in `security-review` | **SEC** |
| **any change at all** | built-in `code-review` | **CORRECT** |
| `*.md` whose added lines open a ` ```mermaid ` fence | `mermaid-diagram` | DOCS |

Two rows route on **diff content**, not on path: the `zod` row's `from 'zod'` clause and the
`mermaid-diagram` row. Both read the added-lines stream, never the file on disk — importing
Zod on `BASE` is not this diff's business.

`web-design-guidelines` and `vercel-react-best-practices` are **global** skills (available to
the agent, not vendored under `.claude/skills/`). If either is unavailable in the session,
record it as a skipped skill with reason `skill not available in this session` rather than
silently dropping it — a skipped check the reader never hears about is worse than one that
did not exist.

## Files that route but are not line-reviewed

| Kind | Detect | Routing |
|---|---|---|
| Deletion (`D`) | status `D` | Routed for the reference sweep below. Not line-reviewed — there is no new side, and grounding would drop every finding anyway. |
| Pure rename (`R100`) | status `R100` | Excluded from LLM line review, **kept** for `frontend-ui-architecture`. A pure move is exactly the question that skill answers. |
| Binary | `--numstat` row is `-<TAB>-<TAB>path` | Excluded entirely. Named in Coverage. |

**The one check a deletion does get** — dangling references:

```bash
grep -rn "<basename-without-extension>" client/src server/src reviewer-core/src e2e \
  --include='*.ts' --include='*.tsx'
```

Run it per deleted file. On the current tree this is a live case:
`client/src/components/mermaid-diagram/MermaidDiagram.tsx` and its `index.ts` are deleted,
so the sweep asks whether anything still imports `mermaid-diagram`.

## Worked example — the current working tree

81 entries in `CHANGED` (4 renames, 3 deletions, ~45 modifications, the rest untracked).
Routing produces:

| Group | Files (representative) | Skills loaded |
|---|---|---|
| SEC | every `.ts`/`.tsx`/`.yml`/`package.json` in the set | `security`, `security-review` |
| CORRECT | all 81 | `code-review` |
| BE | `server/src/app.ts`, `modules/pulls/routes.ts`, `modules/repos/service.ts`, `platform/{errors,jobs,sse}.ts`, `adapters/llm/openai.ts` | `onion-architecture`, `fastify-best-practices` |
| DATA | `server/src/db/schema/{context,knowledge,pulls,reviews,runs}.ts`, `db/migrate.ts`, `db/seed.ts`, `db/migrations/0011_quiet_patch.sql`, `modules/reviews/repository.ts`, `modules/repo-intel/repository.ts` | `drizzle-orm-patterns`, `postgresql-table-design` |
| CONTRACT | `server/src/vendor/shared/contracts/findings.ts`, the six `client/src/vendor/shared/**` files, `reviewer-core/tsconfig.json` | `zod`, `typescript-expert` |
| FE | the eight `client/src/app/**` files, `components/diff-viewer/…`, `lib/format.ts` | `frontend-ui-architecture`, `next-best-practices`, `react-best-practices`, `web-design-guidelines`, `vercel-react-best-practices` |
| TEST | `client/src/test/smoke.test.tsx`, the four `client/src/test/showcase/*` renames, `server/test/{helpers/pg.ts,indexer-pipeline.test.ts}`, `reviewer-core/test/run.test.ts` | `react-testing-library` |
| DOCS | `AGENTS.md`, `*/AGENTS.md`, `docs/agent-prompts/choosing-a-model.md`, `server/INSIGHTS.md` — **only if** one of them adds a mermaid fence | `mermaid-diagram` |

Eight groups from one diff is what "reviewed everything" costs. It is also why the cost plan
is printed before any subagent is spawned (`SKILL.md` §4) — a reviewer that quietly spends
eight agent calls is a reviewer the user turns off.

Note what routing does **not** do here: `.github/workflows/*.yml` matches only SEC and
CORRECT. No skill in the catalog covers GitHub Actions, and inventing coverage for it would
be worse than the honest `no matching skill` line in the report. The same is true of
`scripts/*.sh`.
