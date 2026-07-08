---
name: doc-writer
description: Documentation standards for the dev-digest project — doc type to location mapping, per-symbol documentation structure, topological generation order, Mermaid conventions, and quality checks before writing.
---

# Doc Writer

## Doc Type → Location Mapping

Always write docs to the correct location:

| Input | Output type | Location |
|---|---|---|
| Feature requirements / conversation notes | Feature specification | `docs/feature-requirements/<feature>.md` |
| Implementation plan document | Design doc | `docs/design/<feature>.md` |
| Source module (`*.ts`) | Module overview | `<package>/README.md` |
| Route definitions (`routes.ts`) | API reference | `docs/design/api-<module>.md` |
| Architecture analysis | Architecture doc | `docs/design/architecture-<topic>.md` |

When the target file does not exist, create it. When it exists, **extend it** — never overwrite existing content unless explicitly instructed.

## Per-Symbol Documentation Structure

For every exported function, class, or type, document in this order:

1. **Functionality** — one sentence: what does this symbol do?
2. **Parameters** — typed list: `paramName: TypeName — description`
3. **Behavior** — detailed description: what happens when called, including side effects
4. **Notes** — edge cases, gotchas, non-obvious constraints
5. **Examples** — representative usage snippet

```markdown
### `findAll(workspaceId: string): Promise<Repo[]>`

**Functionality**: Returns all repositories belonging to the given workspace.

**Parameters**:
- `workspaceId: string` — UUID of the workspace to query

**Behavior**: Queries the `repos` table filtered by `workspace_id`. Returns an empty array when the workspace has no repos. Throws `AppError(404)` when the workspace does not exist.

**Notes**: Does not return soft-deleted repos. Results are ordered descending by `created_at`.

**Examples**:
\`\`\`ts
const repos = await reposService.findAll('ws-abc123')
// → [{ id: 'r-1', name: 'dev-digest', ... }]
\`\`\`
```

## Generation Order (Topological)

Always document in bottom-to-top order: leaf dependencies first, consumers after.

Example: `schema.ts` → `repository.ts` → `service.ts` → `routes.ts` → module README

Example order for `server/src/modules/repos/`:
1. `repos.schema.ts` (no internal deps)
2. `repos.repository.ts` (depends on schema)
3. `repos.service.ts` (depends on repository)
4. `repos.routes.ts` (depends on service)
5. Module `README.md` section (references all of the above)

## Mermaid Conventions

Use `mermaid-diagram` skill (read `.claude/skills/mermaid-diagram/SKILL.md`) before generating any diagram.

| Diagram type | Mermaid keyword | When to use |
|---|---|---|
| Module boundary diagram | `C4Component` | Shows which modules import which |
| API flow diagram | `sequenceDiagram` | Shows request/response flow per endpoint |
| Agent/workflow routing | `flowchart TD` | Decision logic, routing rules, data pipeline steps |

- Every module README with >2 imported dependencies gets a C4 component diagram
- Every API reference doc gets a sequence diagram per key flow
- Diagrams go in fenced ` ```mermaid ` blocks within the markdown file
- Never use the deprecated `graph` syntax — always use `flowchart TD` (or `LR`/`BT`/`RL`)

## Converting an Implementation Plan to a Design Doc

Steps:
1. **Remove**: internal implementation notes, step-by-step task breakdowns, acceptance check commands
2. **Keep**: what the feature does, public API surface, data flows, architectural decisions
3. **Add**: Mermaid diagrams (C4 for modules, sequence for API flows)
4. **Link**: to related modules and design docs using relative markdown links

Output to `docs/design/<feature>.md`.

## Quality Checks (Must Pass Before Writing)

Hard stop if any check fails:

- Every referenced file path exists → verify with `Glob`
- Every referenced function/type/export exists → verify with `Grep`
- All required sections present (see per-symbol structure above)
- No Mermaid syntax errors (check: no deprecated `graph` keyword, correct node/edge syntax)

## Style Rules

- No "this document describes…" openers — start with the subject directly
- One sentence per paragraph for technical descriptions
- Code snippets for every non-trivial example
- No future tense ("will be") — describe current state only
- Write for the developer reading the code for the first time
- Focus on "what" and "why" — not "how" (that lives in the code)
- Cross-link to related modules and AGENTS.md sections
- Keep prose sections short — prefer tables and diagrams over paragraphs
