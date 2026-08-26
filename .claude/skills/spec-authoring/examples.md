# Examples — spec authoring

Worked pairs for the parts of the format that go wrong most often.

## Acceptance criteria

### The obvious failures

| ❌ | ✅ |
|---|---|
| The system shall handle errors gracefully. | IF the GitHub API returns a non-2xx status, THEN the system shall persist the run as `failed` with the upstream status code in `status_reason`. |
| The review should be fast. | WHEN a diff under 500 changed lines is submitted, the system shall return findings within 30 seconds at p95. |
| The UI should be accessible. | The system shall render every interactive control with an accessible name, and shall move focus to the first error on a failed submit. |

### The failures that look fine

These read like criteria and are not — the trap is subtler than a vague adjective.

| ❌ | Why it fails | ✅ |
|---|---|---|
| WHEN a review completes, the system shall update the UI. | "Update" is unobservable — any repaint satisfies it. | WHEN a review completes, the system shall replace the pending row with the finding count and the verdict badge. |
| The system shall validate the input. | Validate against what, and what happens on failure? Two criteria hiding as one. | The system shall reject a `severity` value outside the contract enum with `422` before the handler runs. |
| IF the model is unavailable, THEN the system shall degrade gracefully. | Names a condition and then hides the response behind the banned word. | IF a structured model call fails, THEN the system shall render the deterministic overview and state the degradation reason in the card header. |
| WHEN the user clicks Recompute, the system shall recompute the intent. | Restates the trigger as the response. Says nothing a reader could check. | WHEN the user clicks Recompute, the system shall issue exactly one `POST /pulls/:id/intent` and disable the control until it resolves. |
| The system shall support large repositories. | A capability, not a behaviour. No threshold, no consequence. | WHEN a repository exceeds 20 000 indexed files, the system shall build the overview from deterministic facts only, without reading every file in full. |

**The recurring shape:** a criterion fails when the response half could be satisfied by doing
nothing observable. Read only the clause after `shall` and ask what a screenshot, a log line, a
status code, or a row would have to show.

### Splitting a compound criterion

One `AC` per checkable behaviour. When `and` joins two things that could fail independently, it is
two criteria — otherwise a half-failure has no verdict.

❌ `AC-4`: WHEN a run finishes, the system shall persist the findings and notify the client.

✅
- `AC-4`: WHEN a run finishes, the system shall persist one row per surviving finding.
- `AC-5`: WHEN a run finishes, the system shall emit a `run.completed` SSE event carrying the run id.

## The design partition

From a mockup of a "Blast Radius" card. Note that bucket 2 names each item individually — a blanket
"some details are illustrative" tells the implementer nothing.

```markdown
## Design review

**Source:** `docs/mockups/blast-radius.png` — read: yes

**Where the design IS the spec**
- The count strip sits above the symbol list, not beside it.
- Symbol rows are collapsible; callers are nested one level inside a symbol.
- Endpoint and cron chips render inline on the symbol row that declares them.

**Where the design is NOT the spec — artistic licence, do not implement**
- The symbol names shown (`resolveIntent`, `buildOverview`) are illustrative; they are not a
  required set and must not become fixtures.
- The card shows exactly six symbols with no overflow affordance. Six is the mockup fitting the
  frame, not a limit — see `AC-9` for the real one.
- The heading is set in a weight the design system does not define.

**What the design does not contradict**
- Ordering within the symbol list. Unspecified by the image; `AC-7` sets it by import-graph rank.
- Whether chips wrap or truncate at narrow widths.

**States the design omits** — loading, empty (no symbols), error, partial (index stale), offline.
All five are specified in `## Edge cases`; the mockup shows only the populated state.
```

## Module interactions

Prose first. A diagram only when the call graph is genuinely clearer as a picture — three modules in
a line is prose.

```markdown
## Module interactions

- **client → server.** `BlastCard` calls `GET /pulls/:id/blast` through `lib/hooks/use-blast.ts`.
  On a non-2xx the card renders its own error branch; on a malformed payload the hook throws in
  render, so the card is wrapped in an error boundary keyed by `prId` (see `client/INSIGHTS.md`,
  2026-08-25).
- **server → repo-intel.** The blast module calls `repoIntel.getBlastRadius(repoId, changedFiles)`
  and re-implements none of that logic.
- **On refusal or degradation.** WHEN the index is stale or absent, `repo-intel` returns a partial
  result; the endpoint sets `status: 'partial'` with a non-empty `status_reason`, and the card
  renders the reason rather than an empty state — an empty blast radius and an unknown one must not
  look the same.
```

## Non-goals that earn their place

A non-goal is only useful when a reasonable reader would otherwise assume it *is* included.

| ❌ Not worth writing | ✅ Worth writing |
|---|---|
| Not building a mobile app. | Not recomputing the blast radius on every PR sync — it is computed on demand and cached until the head SHA changes. |
| Not changing the database. | Not showing transitive callers beyond depth 1. The graph supports it; the card deliberately does not, because depth 2 was unreadable in review. |
