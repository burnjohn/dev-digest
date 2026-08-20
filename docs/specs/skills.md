# Spec — Skills (storage, editor, agent binding, import)

Status: **implemented** (2026-08-05) · Owner: A1 (skills) with A2 (agents) touch-points
Scope: `server/` · `client/` · `reviewer-core/` (read-only) · seed data

A **skill** is reusable review guidance: a name, a directive description, a type, and
a markdown body. It is **text and configuration only** — a skill never executes code,
never declares tools, and never reaches the filesystem or the network. Agents link
skills; the linked, enabled skills are appended to the agent's prompt in the order the
user chose.

---

## 1. Decisions taken

| # | Decision | Consequence |
|---|----------|-------------|
| D1 | The agent-tab checkbox is a **per-link** flag, not link/unlink | new `agent_skills.enabled` column (migration); `skills.enabled` stays a global kill-switch |
| D2 | ~~`/skills` is a card grid + side drawer~~ → **superseded by the design review**: `/skills` is a **list rail + five-tab editor** at `/skills/[id]` (Config · Preview · Evals · Stats · Versions), mirroring the agent editor | two routes; the `page.selectPrompt` / `detail.*` strings that already shipped were written for exactly this layout |
| D3 | Import accepts **`.md` and `.zip`** | zip: pick the skill core, list every other entry as *ignored*; nothing is executed or written to disk |
| D4 | Skill bodies are injected as **trusted text**, with a UI warning on imported skills | no `reviewer-core` change; the trust story is product/UX, not delimiters — **see §9, existing copy contradicts this** |
| D5 | Editing a skill **snapshots a version** | fills `skill_versions`, mirrors `AgentsRepository.snapshotVersion` |
| D6 | Test Quality Reviewer + API Contract Reviewer and their skills are **seeded** | control experiment reproduces from a fresh clone |

**D7 — changing an agent's skill links bumps the agent's config version. Implemented.**
`setSkills` / `linkSkill` / `unlinkSkill` now call `bumpForSkillChange`, and
`snapshotVersion` records only the links that were *enabled*, i.e. the ones that
actually shaped the prompt. Without this, two runs of "v3" could use different
skills. Covered by `test/skills.it.test.ts` ("bumps the agent version on a link
change and snapshots only enabled skills").

---

## 2. What already exists (do not rebuild)

The starter shipped the whole data + contract + prompt layer for this feature and
stopped just short of the module and the UI.

| Layer | Already there | File |
|-------|---------------|------|
| DB | `skills`, `skill_versions`, `agent_skills` tables | `server/src/db/schema/skills.ts`, `.../agents.ts` |
| Contracts | `Skill`, `SkillType`, `SkillSource`, `CommunitySkill`, `AgentSkillLink`, `AgentVersionConfig.skills` | `server/src/vendor/shared/contracts/knowledge.ts:114-199` |
| Agent-side API | `GET/POST /agents/:id/skills` (list, set-all, link-one) | `server/src/modules/agents/routes.ts:145-165` |
| Agent-side data | `linkedSkills`, `skillIdsForAgent`, `linkSkill`, `unlinkSkill`, `setSkills` | `server/src/modules/agents/repository.ts:189-235` |
| Prompt | `## Skills / rules` section + `PromptAssembly.skills` | `reviewer-core/src/prompt.ts:88-138` |
| Engine input | `ReviewInput.skills?: string[]` (resolved bodies, not slugs) | `reviewer-core/src/review/run.ts:55` |
| Trace | trace drawer renders the skills block with its own colour | `client/.../RunTraceDrawer/_components/TraceBody/TraceBody.tsx:74` |
| i18n | **the entire `skills` namespace + `agents.skills` + `agents.editor.tabs.skills`** | `client/messages/en/skills.json`, `agents.json` |
| Routing | `activeKeyFor()` already maps `/skills` → `"skills"` | `client/src/components/app-shell/helpers.ts:33` |

**The gaps are exactly four:** no `skills` server module; `run-executor` never loads
skills so the prompt block is always empty; no UI; no seed data.

---

## 3. Data model

### 3.1 Migration (one migration, generated — never hand-written)

```
server/src/db/schema/agents.ts   agent_skills += enabled boolean not null default true
server/src/db/schema/skills.ts   + index on skills.workspace_id
                                 + index on agent_skills.skill_id   (reverse: "used by N agents")
                                 + check(skills.type   in (rubric, convention, security, custom))
                                 + check(skills.source in (manual, imported_url, extracted, community))
```

Then `pnpm db:generate` → `pnpm db:migrate`. **Trap (server/INSIGHTS.md):** editing the
Drizzle schema changes nothing until a migration is generated, and this repo does not
apply migrations on boot — TypeScript and Postgres will disagree silently otherwise.
`ADD CONSTRAINT … CHECK` validates existing rows; both tables are empty today, so the
CHECKs are safe to add now and would not be later.

### 3.2 Version snapshot

`skill_versions(skill_id, version, body, message)` — PK `(skill_id, version)`. The table
already existed; `message` (nullable, ≤200 chars, migration `0014`) is the author's
optional "what changed" note, written by the same save that snapshots the body. A blank
or absent note stores NULL, and the UI derives a summary from the diff rather than
inventing one. An enabled-only toggle writes no version, so a note sent with it is ignored.
A change to `body`, `name`, `description` or `type` bumps `skills.version` and inserts
a snapshot with `onConflictDoNothing()`. Toggling `enabled` alone does **not** bump.
This is `isConfigChange()` in the agents module, applied to skill fields.

### 3.3 `AgentVersionConfig.skills` stays `string[]`

It records the ordered ids of the links that were **enabled** at snapshot time — i.e.
the skills that actually shaped the prompt. Keeping the shape means old `agent_versions`
rows still pass `AgentVersionConfig.parse()` in `agents/helpers.ts:39`, which throws on
a malformed snapshot.

---

## 4. Contracts (`server/src/vendor/shared/contracts/knowledge.ts`)

Canonical copy first, then **hand-port the delta** to `client/src/vendor/shared/` — the
mirror already lags in five files and there is no sync script (root `INSIGHTS.md`).

```ts
// changed
AgentSkillLink += enabled: z.boolean()

// new — the agent Skills tab needs skill fields + link fields in one call
AgentSkillDetail = Skill.extend({ order: z.number().int(), link_enabled: z.boolean() })

// new — list cards show "used by N agents"
SkillSummary = Skill.extend({ used_by: z.number().int() })

// new — import returns a preview, never a persisted row
SkillImportPreview = z.object({
  name: z.string(),
  description: z.string(),
  type: SkillType,
  body: z.string(),
  source: SkillSource,              // 'imported_url' for now (file import)
  ignored_entries: z.array(z.string()),   // zip members not imported
  warnings: z.array(z.string()),
})

// new — version history
SkillVersion = z.object({ skill_id, version, body, created_at })
```

---

## 5. Server — `src/modules/skills/`

New module, registered with one import + one entry in `src/modules/index.ts`. Shape
follows `agents/`: `routes.ts` (transport, zod schemas) · `service.ts` (business) ·
`repository.ts` (Drizzle) · `helpers.ts` (pure) · `constants.ts`. Routes must not
import `db/schema` — the `transport-never-queries` dependency-cruiser rule enforces it.

### 5.1 Routes

| Method | Path | Body / params | Returns |
|--------|------|---------------|---------|
| GET | `/skills` | — | `SkillSummary[]` (workspace-scoped) |
| GET | `/skills/:id` | uuid | `Skill` |
| POST | `/skills` | `{name, description, type, body, source?, enabled?}` | `Skill` 201 |
| PUT | `/skills/:id` | partial of the above | `Skill` (version bumped when config changed) |
| DELETE | `/skills/:id` | uuid | `{ok:true}` — `agent_skills` cascades |
| GET | `/skills/:id/versions` | uuid | `SkillVersion[]` newest first |
| GET | `/skills/:id/versions/:version` | uuid + int | `SkillVersion` |
| GET | `/skills/:id/agents` | uuid | `{id, name}[]` — shown in the delete confirm |
| POST | `/skills/import` | `{filename, content_b64}` | `SkillImportPreview` — **parses only, persists nothing** |

Every route resolves `workspaceId` through `getContext()` and scopes on it, exactly as
agents does; a cross-workspace id yields 404, not 403.

### 5.2 Agents module changes (A2 touch-points)

- `GET /agents/:id/skills` returns `AgentSkillDetail[]` (join, ordered) instead of the
  bare `AgentSkillLink[]` — the tab needs name/type/description without an N+1.
- `POST /agents/:id/skills` body gains the per-link flag:
  `{ skills: [{ skill_id, enabled }] }` sets the whole ordered set. The existing
  `skill_ids` / `skill_id` forms stay accepted for compatibility.
- `AgentsRepository.setSkills(agentId, [{skillId, enabled}])`; `linkedSkills()` returns
  `enabled` too; new `enabledSkillsForPrompt(agentId)` returns bodies in order where
  `agent_skills.enabled AND skills.enabled`.
- If D7 is accepted: `setSkills` / `linkSkill` / `unlinkSkill` call `snapshotVersion()`.

### 5.3 Import parsing (`helpers.ts`, pure and unit-tested)

No multipart plugin and no YAML dependency are added. The client base64-encodes the
file and POSTs JSON; Fastify's 1 MB body limit is the natural cap (reject >512 KB
decoded with a 413-shaped error).

```
.md   → parseFrontmatter(text)      // '---' block, flat key: value, no YAML dep
        → { name, description, type } fallbacks:
          name        ← frontmatter.name ?? first '# ' heading ?? filename stem
          description ← frontmatter.description ?? first paragraph
          type        ← frontmatter.type if it parses as SkillType, else 'custom'
        body = markdown with the frontmatter stripped

.zip  → fflate.unzipSync(bytes)     // ONE new server dependency (pnpm — see below)
        pick SKILL.md, else skill.md, else the shallowest single *.md
        every other member → ignored_entries[]
        warnings[] when an ignored member is executable-looking
          (.sh .js .ts .py .bat .ps1 .exe, or a member with any x bit)
```

Hard limits, enforced before decompression completes: ≤ 200 members,
≤ 2 MB total uncompressed, ≤ 512 KB for the chosen markdown. Members are read into
memory only — **nothing is written to disk, extracted, or executed**, and member paths
are never resolved against a directory, so path traversal has no surface. A zip with
no markdown member returns a 422 with the member list.

`server/` is a **pnpm** package — add `fflate` with `pnpm add`, not `npm install`
(root `INSIGHTS.md`: half the repo is npm, the wrong tool creates a competing lockfile).

### 5.4 Prompt wiring — `src/modules/reviews/run-executor.ts`

Inside `runOneAgent`, before `reviewPullRequest`:

```ts
const skills = await this.container.agentsRepo.enabledSkillsForPrompt(agent.id);
const blocks = skills.map((s) => `### ${s.name}\n${s.body}`);
runLog.info(`skills: ${skills.length} attached (+~${tokens} tokens)`);   // container.tokenizer
...
...(blocks.length ? { skills: blocks } : {}),
```

- `container.agentsRepo` is the sanctioned path — `reviews` must not import another
  module's folder (`no-cross-module-internals`).
- Omit-when-empty keeps the prompt byte-identical to today for an agent with no skills.
- The `### <name>` header is added **here**, not in `reviewer-core`: the engine takes
  resolved strings and the future CI runner resolves the same slugs from the filesystem;
  it will format identically.
- The token count comes from `container.tokenizer` (js-tiktoken adapter, already wired).
- **No trace work is needed**: run-executor already persists `outcome.assembly`
  (`run-executor.ts:271`), and `assemblePrompt` puts the joined block in
  `PromptAssembly.skills`, which the drawer already renders. Passing skills makes the
  block appear; a disabled skill makes it disappear. That is acceptance criterion #4,
  for free.

---

## 6. Client

All strings already exist in `client/messages/en/skills.json` and the `agents.skills` /
`agents.editor.tabs` keys — **reuse them**, do not invent new ones (except §9).

### 6.1 New files (as built)

```
src/app/skills/page.tsx                  rail + "select a skill" prompt
src/app/skills/[id]/page.tsx             rail + editor; tab lives in ?tab=
src/app/skills/{constants,helpers,styles}.ts   shared by both routes (+ helpers.test.ts)
src/app/skills/_components/SkillsRail/         search · Add Skill · cards
  └── _components/{SkillRailCard, NewSkillModal, ImportSkillDrawer}/
src/app/skills/_components/SkillEditor/        header + Tabs shell (+ SkillEditor.test.tsx)
  └── _components/{ConfigTab, PreviewTab, EvalsTab, StatsTab, VersionsTab}/
src/lib/hooks/skills.ts                  useSkills, useSkill, useCreateSkill, useUpdateSkill,
                                         useDeleteSkill, useImportSkillPreview,
                                         useSkillVersions, useSkillAgents,
                                         useAgentSkills, useSetAgentSkills
src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/
                                         checkbox list, drag + ↑↓ reorder, filter, count
```

**Config** — line-numbered markdown editor, `unsaved` badge, `~N tokens` hint (the `~`
is load-bearing: the client has no tokenizer, so it uses the same `chars / 4` fallback
the server has), and an optional **Version message** ("what changed in this version?").
**Preview** — the body as the agent receives it. **Versions** — shows the author's
message when a save recorded one, otherwise a summary derived from a client-side LCS
line diff; *Restore* writes the old body **forward as a new version** (labelled
"Restored from vN"), keeping the history append-only. **Stats** — only what has a source: used-by and the
agent list are real; pull frequency / accept rate / findings-30d render as `—` with
*"not tracked yet — findings are not attributed back to the skill that produced them"*.
**Evals** — names the lesson it arrives with rather than rendering placeholder scores.

Conventions that bite here (`client/CLAUDE.md`, `client/INSIGHTS.md`): double quotes,
no `.js` on relative imports, no `fetch` in a component (hooks only), pages stay thin,
`@testing-library/user-event` is **not installed** — tests use `fireEvent`.

### 6.2 Editor form (Config tab)

Fields: **name** (required) · **description** · **type** (select) · **body** (markdown,
line-numbered). The description field carries the directive-interface hint under it —
"The skill's interface — write it as a directive, saying when the skill applies." Save →
`PUT /skills/:id` → toast "Saved (v{version})" so the version bump is visible. Toggling
`Enabled` patches that field alone, which is what keeps it from bumping the version.

### 6.3 Agent Skills tab

Matches the mock: header `Skills` + `{linked} of {total} enabled` chip, filter input,
`orderHint` line, then rows of `[drag handle] [checkbox] [name] [type chip]`.

- Checkbox toggles `agent_skills.enabled` (D1) — the row stays in place.
- Reorder: native HTML5 `draggable` rows (no dnd dependency exists and none is added),
  plus ↑/↓ `IconBtn`s on each row for keyboard and test reachability.
- Both actions issue `POST /agents/:id/skills` with the full ordered array, optimistic
  on the query cache, invalidate on settle.
- A skill whose global `skills.enabled` is false renders struck-through with a
  "disabled globally" hint — it cannot be enabled from here.
- `AgentEditor/constants.ts` `TABS` gains `skills`; `VALID_TABS` in
  `src/app/agents/[id]/page.tsx` gains `"skills"`.

### 6.4 Navigation — the one sanctioned vendor edit

`client/src/vendor/ui/` is "treat as a library". Adding the sidebar entry requires
editing `src/vendor/ui/nav.ts`, which is a **data registry, not component code**, and
`activeKeyFor()` already expects `/skills`. Add:

```ts
{ section: "SKILLS LAB", items: [
  { key: "skills", label: "Skills", icon: "Sparkles", href: "/skills", gKey: "s" },
  { key: "agents", label: "Agents", icon: "Cpu",      href: "/agents", gKey: "a" },
]}
```

…moving `agents` out of `WORKSPACE` to match the mock, plus `{ keys: "g s", … }` in
`SHORTCUTS`. Flag it in the PR description as a deliberate vendor change.

---

## 7. Seed data (D6)

`server/src/db/seed.ts`, idempotent by name like the existing agents block:

| Skill | type | Bound to |
|-------|------|----------|
| `test-coverage-nudge` | custom | Test Quality Reviewer |
| `corner-case-checklist` | rubric | Test Quality Reviewer |
| `mocking-smells` | convention | Test Quality Reviewer |
| `contract-breaking-change` | rubric | API Contract Reviewer |
| `response-shape-guard` | convention | API Contract Reviewer |

Two agents, both `enabled: false` by default so a fresh clone's review runs are
unchanged until the lesson turns them on:

- **Test Quality Reviewer** — uncovered branches, missing corner cases, over-mocking,
  flake signals. Prompt drafted in `docs/agent-prompts/test-quality-reviewer.md`.
- **API Contract Reviewer** — breaking changes to route signatures, request/response
  shapes, status codes. `docs/agent-prompts/api-contract-reviewer.md`.

At least one skill is **replaced through the import flow on camera**, so the demo covers
the whole path even though the seed makes it reproducible.

---

## 8. Testing

| Lane | What | Where |
|------|------|-------|
| server unit | `parseFrontmatter` (present/absent/malformed), zip member selection, ignored + warning classification, size/member caps, `isSkillConfigChange` | `server/test/skills-helpers.test.ts` |
| server it | CRUD + workspace scoping, version bump on body edit vs no bump on toggle, link set/reorder/per-link enable, cascade on delete | `server/test/skills.it.test.ts` (**the `.it.` suffix is what selects the integration lane; without it the DB test runs in the unit lane and fails**) |
| server it | prompt contains only `link.enabled && skill.enabled` bodies, in link order; zero skills → assembly identical to today | `server/test/skills-prompt.it.test.ts` |
| client | SkillCard render + toggle, drawer preview→edit→save, import preview lists ignored entries and does not POST before confirm | colocated `*.test.tsx` |
| client | SkillsTab: count chip, checkbox toggle, ↑/↓ reorder issues one ordered POST | colocated `*.test.tsx` |

Server integration tests self-skip without Docker and report green — check the run count,
not the exit code (`server/INSIGHTS.md`).

---

## 9. Copy conflict — resolved in the shipped `skills.json`

`client/messages/en/skills.json` was written for a **different trust model** than D4.
These strings claim skill bodies are delimiter-wrapped, which under D4 they are not:

| Key | Current text | Problem |
|-----|--------------|---------|
| `file.bodyHint` | "Pasted content is wrapped as untrusted data — never executed as instructions." | false under D4 |
| `file.success` | "Imported \"{name}\" (stored as untrusted data)." | false under D4 |
| `url.hint` | "Fetched server-side, stored as untrusted…" | false, and URL import is out of scope |
| `preview.untrustedNotice` | "…stored as data (delimiter-wrapped) and must be vetted…" | false under D4 |

Rewrite them to the honest version: *"An imported skill's text becomes instructions in
your agent's prompt. Read it before you enable it."* Keep `listItem.needsVetting` and
`preview.untrustedBadge` — the badge is exactly the D4 warning. `drawer.tabs.url` /
`.community` and the whole `community` / `url` blocks stay in the file **unused** and
out of scope for this iteration.

New strings to add: `page.menu.fromFile` covers `.md`/`.zip` (reword to "Import from
file (.md or .zip)"), an `import.ignored` section ("Not imported ({count})"), an
`import.executableWarning`, and the description-field directive hint (§6.2).

---

## 10. Work breakdown — all waves shipped

Applying it to an existing database is a **manual third step**: `pnpm db:generate`
writes migration `0013_old_rawhide_kid.sql`, but nothing applies it on boot, so a
running dev server keeps failing with `column agent_skills.enabled does not exist`
until `pnpm db:migrate` (then `pnpm db:seed` for the new agents and skills).

| Wave | Deliverable | Files |
|------|-------------|-------|
| 1 | Schema + migration + contracts | `db/schema/{skills,agents}.ts`, generated migration, `vendor/shared/contracts/knowledge.ts` (**+ hand-port to client**) |
| 2 | `skills` module (CRUD + versions), registry entry | `server/src/modules/skills/*`, `modules/index.ts` |
| 3 | Import parsing + `POST /skills/import` + `fflate` | `modules/skills/helpers.ts`, `package.json` (pnpm) |
| 4 | Agents link changes (per-link enabled, detail DTO, D7) | `modules/agents/{routes,service,repository,helpers}.ts` |
| 5 | Prompt wiring + token log | `modules/reviews/run-executor.ts` |
| 6 | `/skills` page: grid, card, preview/edit drawer, hooks | `client/src/app/skills/*`, `lib/hooks/skills.ts` |
| 7 | Import drawer + copy fixes (§9) | `.../ImportSkillDrawer/*`, `messages/en/skills.json` |
| 8 | Agent Skills tab + nav + shortcut | `.../SkillsTab/*`, `AgentEditor/constants.ts`, `agents/[id]/page.tsx`, `vendor/ui/nav.ts` |
| 9 | Seed agents + skills + prompt docs | `db/seed.ts`, `docs/agent-prompts/*.md` |
| 10 | Tests across all lanes | §8 |

Waves 1–5 are backend and land independently of 6–8; 9–10 close it out.

---

## 11. Acceptance checklist (mirrors the lesson's own list)

1. A skill is created and edited in the UI; a body edit bumps the version and writes a
   `skill_versions` row.
2. Both new agents exist with ordered skills bound to them.
3. An enabled skill appears in the run trace as its own `## Skills / rules` block with
   its `### name` header and a logged token delta; disabling it removes the block.
4. Import ran through a preview: the zip's non-markdown members were listed as ignored,
   nothing was written to disk or executed, and the skill was persisted only after
   confirmation.
5. Control experiment — **Test Quality**: a happy-path-only test PR is missed with skills
   off and flags the uncovered branch + boundary case with skills on. **API Contract**: a
   route-signature change is missed with skills off and reported as a breaking change with
   skills on. Both reproduce from a fresh clone plus `pnpm db:seed`.
6. `pr-self-review` still exists with auto-invoke off, is invokable by hand, and pulls in
   both frontend and backend skills.

---

## 12. Risks

- **Contract mirror drift** — the client copy of `@devdigest/shared` lags in five files
  already; forgetting the hand-port makes the Skills page compile against a stale `Skill`.
- **Migration not applied** — a schema edit without `pnpm db:generate` + `db:migrate`
  gives a `column agent_skills.enabled does not exist` at runtime only.
- **No transactions anywhere in the server** — `setSkills` is a delete-then-insert, so a
  crash between them empties an agent's skill list. Pre-existing repo-wide condition
  (root `INSIGHTS.md`); called out, not fixed here.
- **`AgentVersionConfig.parse` throws on drift** — do not change the `skills` field shape
  in the snapshot (§3.3).
- **Prompt-size blowout** — five 2 KB skills plus repo-intel context can crowd the diff;
  the token log in §5.4 makes it visible, but no budget enforcement ships in this iteration.
