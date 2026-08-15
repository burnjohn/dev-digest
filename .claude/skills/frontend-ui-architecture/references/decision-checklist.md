# Decision checklist: where does this file go?

A mechanical procedure. Run it top to bottom; the first rule that matches wins. Use it when the
table in SKILL.md §2 does not answer directly, or when reviewing a diff that adds files.

---

## Step 0 — Is this even a new file?

Before creating one, check whether the thing already exists somewhere. Two components with 80%
overlap in different folders is the most expensive placement mistake, because no rule catches it
later. Search for the domain noun (`pr-row`, `review-run`) across the repo first.

If the answer is "it exists but in the wrong place", the task is a **move**, not a create.

---

## Step 1 — Count the consumers

| Consumers | Where |
|---|---|
| 0 (speculative — "we'll need it") | Do not create it |
| 1 | Next to that consumer |
| 2, same route section | The section's shared folder (`app/(shop)/_components/`) |
| 2+, different sections | The global shared folder (`src/components/`, `src/lib/`) |

"Consumer" means a file that imports it *today*. Not a planned one.

If you are moving from 1 → 2 consumers, do the move in the same commit as the second consumer, so
the diff shows why it moved.

---

## Step 2 — Does it render UI?

- **Yes, and it is a route** → `app/<segment>/page.tsx` (or `layout`/`loading`/`error`/`route`).
  Keep it thin: read params, call a loader, compose. Move any logic to `_lib/` or the DAL.
- **Yes, not a route** → a component. Go back to Step 1 for the folder, then give it its own
  folder if it has more than one file (component + test + types + helpers).
- **No** → continue.

---

## Step 3 — Does it call a hook?

- **Yes** → it is a hook. Name it `use-*.ts`, place per Step 1.
- **No** → it is a plain module. Do **not** name it `use-*`, even if it is used by hooks. A
  non-hook named `use-` breaks the rules-of-hooks lint rule and misleads every reader.

---

## Step 4 — Does it touch the database, secrets, or `process.env`?

- **Yes** → `src/server/` with `import 'server-only'` at the top. Authorization checks live here,
  and it returns DTOs — shaped for the UI, containing nothing the client should not see.
  A Server Action stays thin and delegates here.
- **No** → continue.

---

## Step 5 — Does it know about your domain?

- **Yes** (mentions PRs, repos, reviews, users…) → it is a *helper*. `helpers.ts` beside the code
  that owns that domain concept.
- **No** (works on strings, arrays, dates, with no product knowledge) → it is a *util*.
  `src/lib/utils/`. Test: could you publish it to npm unchanged and would it still make sense?

---

## Step 6 — Is it a type?

- Comes from the API / a shared contract → import it from the contract. Never re-declare a
  server-owned shape in the client; the duplicate silently drifts.
- Exists only for the UI (props, view models, form state) → `types.ts` beside the component, or
  inline in the component file if used once.

---

## Step 7 — Is it a test?

- Unit or component test → `x.test.tsx` beside `x.tsx`. Same folder, always.
- End-to-end → `e2e/` at the project root. It tests the running app, not a module, so it has a
  different lifecycle and a different runner.
- Test helpers used by 2+ test files → same promotion rules as any other code.

---

## Step 8 — Name it

1. `kebab-case` file and folder names.
2. Suffix by role: `.test.tsx`, `.stories.tsx`, `types.ts`, `constants.ts`, `helpers.ts`.
3. `PascalCase` for the exported component identifier; the file name still lowercase.
4. Singular for domain folders; route segments follow the URL.
5. Never rename a framework file (`page.tsx`, `layout.tsx`, `route.ts`, `proxy.ts`).

---

## Step 9 — Check the import direction

After placing the file, look at its imports:

- Does it import *upward* (shared code reaching into a route/feature)? Then it is not shared —
  move it back down, or invert with a prop/parameter.
- Does it import *sideways* (route A → route B)? Promote the shared piece to the nearest common
  ancestor and have both import it from there.
- Does any import contain `../../`? It has crossed a module boundary; use the `@/` alias, and if
  the target is not meant to be importable, that is a boundary violation to fix, not to alias.

---

## Escalation: when the checklist keeps failing

If the same file keeps not fitting anywhere, the structure is telling you something:

- **Everything ends up in `src/lib/`** → `lib` has become a junk drawer. Split by domain
  (`lib/github/`, `lib/format/`), not by adding files.
- **A route folder has 15+ colocated components** → it is a feature, not a page. Give it its own
  folder with an internal `components/`, `hooks/`, `lib/` split.
- **Two routes keep needing each other's code** → they are one feature split across two URLs.
  Extract the shared feature module; the routes become thin views over it.
