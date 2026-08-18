# Routing — changed files → zones → skills

Two independent mappings. Keep them separate; they change for different reasons.

1. **File → zone.** Mirrors the `paths:` filters in `.github/workflows/*.yml`.
   Changes when CI changes.
2. **Zone/glob → skills.** Changes when a skill is added.

## 1. Zones (mirror of CI `paths:`)

A zone is "the set of files one CI workflow watches". Deriving zones from the
workflows rather than inventing a parallel list is the whole point: a local
`PASS` is only worth something if it covers exactly what CI will run.

| Zone            | Owning workflow                              | Trigger paths (verbatim from the workflow)                                                     |
| --------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `client`        | `client.yml`                                 | `client/**`, `scripts/check-contracts.sh`, `.github/workflows/client.yml`                        |
| `server`        | `server-unit.yml`, `server-integration.yml`  | `server/**`, `reviewer-core/**`, `scripts/check-contracts.sh`, the two workflow files            |
| `reviewer-core` | `reviewer-core.yml`                          | `reviewer-core/**`, `server/src/vendor/shared/**`, `.github/workflows/reviewer-core.yml`         |
| `e2e`           | `e2e-web.yml`                                | `client/**`, `server/**`, `e2e/**`, `.github/workflows/e2e-web.yml`                              |

**Re-read the workflows on every run.** Do not trust this table if it disagrees
with them — the workflows are canonical, this is a cached copy. If they have
drifted apart, emit `WARNING: routing.md is stale vs .github/workflows/` and use
the workflows.

### Cross-zone triggers worth knowing

These are already encoded in the `paths:` above, but they are the non-obvious
part and the reason zone ≠ directory:

- `reviewer-core/**` activates the **server** zone too — `server` aliases
  `../reviewer-core/src` at type-check time.
- `server/src/vendor/shared/**` activates the **reviewer-core** zone — it
  aliases `@devdigest/shared` to the server's copy.
- `client/**` or `server/**` activates the **e2e** zone. E2E is expensive and
  hermetic-but-slow; see the budget rule in `SKILL.md` for when to actually run
  it versus just report that it would run in CI.

## 2. Zone / glob → skills

Only skills that exist in `.claude/skills/` may appear here. The router
self-audit (`SKILL.md`, step 7) fails if a skill exists but is absent from this
table — an unrouted skill never runs, and a report that does not say so is
lying.

| Glob                                                     | Skills                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------- |
| `client/src/app/**`, `client/src/components/**`           | `frontend-ui-architecture`, `next-best-practices`, `react-best-practices` |
| `client/**/*.test.ts`, `client/**/*.test.tsx`             | `react-testing-library`                                                   |
| `server/src/modules/**`                                   | `onion-architecture`, `fastify-best-practices`                            |
| `server/src/db/schema.ts`, `server/src/db/migrations/**`  | `drizzle-orm-patterns`, `postgresql-table-design`                         |
| `reviewer-core/src/**`                                    | `onion-architecture`                                                      |
| `server/src/vendor/shared/contracts/**`                   | `zod`, `response-schema`                                                  |
| `e2e/**`                                                  | — (no skill; use the checklist in `e2e/README.md`)                        |
| any `*.ts` / `*.tsx` in any zone                          | `typescript-expert`                                                       |
| **by hunk content, not path** (see below)                 | `security`, `semver-discipline`, `deprecation-policy`                    |
| never routed here                                         | `mermaid-diagram`, `engineering-insights` (authoring tools, not reviewers) |

### Notes on individual routes

- **`onion-architecture` on `reviewer-core/src/**`** — load its
  `references/reviewer-core-purity.md`. The core takes exactly one injected
  `LLMProvider` port; a new import of `fs`, `pg`, or an HTTP client inside it is
  a dependency-rule violation, not a style preference.
- **`zod` on `contracts/**`** — the same schema drives request validation,
  response serialization and LLM structured output. A widened union is a
  three-consumer change, and `scripts/check-contracts.sh` (Stage A) is what
  catches the half of it that still compiles.
- **`response-schema` on `contracts/**`** — narrower than `zod`: fires when
  the hunk changes an *existing* field's type or optionality (not a
  wholly-new schema, which stays `zod`'s territory). Checks that the DB
  column, the row→DTO adapter, the route's response schema, the client
  mirror and its consumers were all updated to match — `check-contracts.sh`
  only proves the two contract copies agree with each other, not that every
  consumer was updated.
- **`e2e/**` has no skill.** Say so in the report's "skipped" line rather than
  silently routing nothing.

### Content triggers for `security`

`security` is routed by what a hunk *does*, not where it lives — a path filter
would both over- and under-fire. Run it when an added/changed line matches any
of:

- auth / session / token / cookie / `jwt` / permission or role checks
- `exec`, `execSync`, `spawn`, `child_process`
- SQL built by string concatenation or template literal (raw `sql` outside
  Drizzle's tagged helper)
- path joins reaching a filesystem read/write from a request parameter
- file upload, `multipart`, `Buffer.from(...,'base64')` on request input
- `process.env`, secret loading, anything touching `~/.devdigest/secrets.json`
- deserialization of request input: `JSON.parse` on a body, `eval`, dynamic
  `import()` with a non-literal specifier

Apply that skill's own confidence rules: only its **HIGH** tier is eligible to
become `CRITICAL`, and even then it still goes through Stage E verification.

### Content triggers for `semver-discipline`

Also content-triggered, for the same reason: a breaking change can land in
`server/src/modules/**`, `reviewer-core/src/**`, or `scripts/*.sh` just as
easily as in `contracts/**`, and a path filter would miss most of those. Run
it when a hunk does any of:

- removes or renames an exported function, class, type, or route
- removes a Zod field/enum member, or moves a field `optional()` → required
- adds a new **required** parameter or request field to an existing
  signature/schema
- narrows an accepted type, or narrows a returned type an existing caller
  could be destructuring
- removes or renames a CLI flag in `scripts/*.sh`, or changes what happens
  when a flag is absent

Findings from this skill overlap `response-schema`'s territory on
`contracts/**` — that's expected; `response-schema` covers the *ripple*
(DB/adapter/client), this skill covers the *classification* (is it breaking
at all, and how to say so).

### Content triggers for `deprecation-policy`

Also content-triggered — a removal can land in any zone, not just
`contracts/**`. Run it when a hunk **removes or plans to remove** an exported
function/class/type, a Zod contract field, a Fastify route, a CLI flag in
`scripts/*.sh`, or a DB column, and the diff does **not** show evidence that
every caller was updated in the same PR (that's the signal semver-discipline
would otherwise flag as a bare MAJOR with no migration path). Check whether
the removal instead went through a visible marker (`@deprecated` JSDoc, a
`.describe()` note on a contract field, a route-level deprecation header, a
flag-parsing warning) with a named replacement and a removal trigger, per
`deprecation-policy`'s per-surface table. Skip it when the diff is the
*removal itself* happening at an already-recorded trigger — that's the
deprecation being honored, not a new one needed.

This overlaps `semver-discipline` by design: that skill decides *whether* a
removal is breaking; this one checks *how* the removal was staged once the
answer is yes.

## 3. Gating rule — when a routed skill actually runs

Being routed is necessary, not sufficient. A skill runs only if its zone has at
least one hunk with a **semantic** change. Skip when every hunk in scope is:

- comment-, whitespace- or formatting-only
- a pure rename (`R100`) with no content delta
- a lockfile, generated file, or snapshot update
- a `.md` change (unless the skill is being routed *for* docs)

Two lines of changed CSS must not drag in a full `onion-architecture` pass. The
skipped skill is still named in the report's "skipped" line, with the reason.

## 4. Slicing rule — what each subagent sees

Each subagent receives **only its own zone's slice** of the diff:

- the hunks it is responsible for, with `file`, `start_line`, `end_line`
- the full current contents of those files, for context
- nothing from other zones

A UI skill must never be shown backend files, and vice versa. This is not only
context economy — a reviewer shown code it has no frame for invents findings
about it.

## 5. Adding a skill

1. Add it to `.claude/skills/`.
2. Add exactly one row here.
3. If it needs the toolchain (a linter, a codegen check), add it to
   `conventions.md` Stage A instead — deterministic beats probabilistic.

Step 2 is not optional. The self-audit exists because it will be forgotten.
