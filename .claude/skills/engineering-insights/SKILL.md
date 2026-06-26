---
name: engineering-insights
description: Captures and preserves non-obvious engineering discoveries in the affected module's insights.md file. Use when: (1) discovering a non-obvious solution, failure pattern, architectural decision, or dependency quirk mid-session ("capture as you go"); or (2) wrapping up a session longer than 30 minutes where a real problem was solved or discovered. Writes append-only to the insights.md of the most directly affected module (client, server, reviewer-core, or e2e). Does not record observations obvious from reading the code or already in CLAUDE.md.
allowed-tools: Read, Edit, Write, Grep, Glob
---

# Engineering insights

Preserves non-obvious engineering knowledge so future agents inherit institutional project knowledge rather than re-discovering it from scratch.

## Three Invocation Modes

**Mode A — Capture as you go** (invoke immediately mid-session):
- Unexpected dependency behavior that cost time to diagnose
- Failure mode that is invisible from reading the code
- Architectural constraint whose reasoning would otherwise be lost
- Workaround for a non-obvious tool or env quirk

**Mode B — Wrap-up** (invoke at session end, or via `/engineering-insights`):
- Session was > 30 minutes AND involved a real problem, decision, or discovery
- Skip: trivial config edits, dependency bumps, typo fixes, pure refactors with no surprises

Zero entries is a valid wrap-up outcome for clean, uneventful sessions.

**Mode C — Session start** (invoke when beginning work on a module):
1. Identify which module files will be touched
2. Read the module's `insights.md`
3. Output in response: total entry count + the 3–5 entries most relevant to the current task
4. Stop — do not write anything in this mode

---

> **HARD CONSTRAINT — existing insights.md files are immutable except via the Edit tool.**
> The Write tool erases the entire file. It is permitted only to create a brand-new insights.md
> from the template when the file does not yet exist.
> Every operation on an existing file (append entry, update footer, mark stale, extend entry)
> MUST use the Edit tool with an exact `old_string` match. No exceptions.

## Workflow

### Step 1 — Apply the Discovery Bar

Ask: **"Would a fresh agent reading this save ≥10 minutes of re-discovery?"**

If no → stop. See [criteria.md](criteria.md) for full filter with examples.

### Step 2 — Identify the Target Module

| Files touched | Write to |
|---|---|
| `client/` | `client/insights.md` |
| `server/` | `server/insights.md` |
| `reviewer-core/` | `reviewer-core/insights.md` |
| `e2e/` | `e2e/insights.md` |

If multiple modules are touched, write to the **most directly affected** one. Never duplicate the same insight across files.

If the target `insights.md` does not exist: use the Write tool to create it from [templates/insights.md](templates/insights.md).
If the file already exists: never use Write — proceed directly to Step 3.

### Step 3 — Read, Summarize, Check for Duplicates

Read the target `insights.md`. Then output in response:

```
Read [module]/insights.md — N entries found.
Relevant to current discovery: [list 0–3 entries, or "none"]
Duplicate of existing entry: [yes/no — if yes, extend that entry instead]
```

After summarizing:
- **Duplicate found** → use the **Edit tool** to locate the exact existing entry text (`old_string` = the full entry line) and append a dated note to it. Do not add a new list item.
- **Existing entry is now wrong** → use the **Edit tool** to replace the exact entry text with its stale form: `~~original text~~` `(superseded YYYY-MM-DD)`, then append the corrected entry as a new line immediately below it.

### Step 4 — Classify

Pick exactly one category:

| Category | When |
|---|---|
| **Pattern** | Approach that worked; reusable solution |
| **Mistake** | Failure mode, antipattern, wrong assumption |
| **Decision** | Architectural or design choice with reasoning |
| **Quirk** | Dependency gotcha, env constraint, non-obvious tool behavior |

When unsure, prefer **Mistake** — it is the most commonly skipped and most valuable category.

### Step 5 — Append via Edit tool

Follow the format in [format.md](format.md). Then use **Edit only** — never Write:

1. Read the current `insights.md` to get the exact text around the insertion point
2. Locate the last existing entry in the target section (or the section's placeholder comment `<!-- ... -->` if the section is empty)
3. Use Edit: `old_string` = that last line exactly, `new_string` = that same line + `\n` + the new entry
4. Locate the current footer line `*Last updated: … · Entries: …*`
5. Use Edit to replace it with the updated date and incremented count

Do not read the file and reconstruct it from scratch. Do not use Write. Touch only the two precise locations: the insertion point and the footer line.

---

## Wrap-up Checklist (Mode B)

Work through these in order. Each question targets a different category:

```
Wrap-up Progress:
- [ ] What failed or took unexpectedly long? (→ Mistake)
- [ ] What constraint exists that is invisible from the code? (→ Quirk or Decision)
- [ ] What decision was made, and why? (→ Decision)
- [ ] What dependency or tool behaved unexpectedly? (→ Quirk)
- [ ] What approach worked and should be reused? (→ Pattern)
- [ ] Discovery bar applied to each candidate?
- [ ] Duplicates checked?
- [ ] Entries appended and footer updated?
```

Aim for 0–5 entries per session.

---

## Maintenance (do not do during capture)

**Monthly:** Scan for stale entries (referenced file deleted, behavior fixed upstream). Mark with ~~strikethrough~~ or remove.

**Promotion:** When an insight has saved time in 3 or more sessions, consider promoting it to the module's `CLAUDE.md` as a permanent rule. Replace the entry with: `→ Promoted to CLAUDE.md YYYY-MM-DD`.

**Pruning:** If any single section exceeds 30 entries, signal-to-noise is degrading. Either prune aggressively or split into a domain-scoped file (e.g., `server/insights-db.md`) and add a pointer in the main file.

---

## References

- [criteria.md](criteria.md) — discovery filter with pass/fail examples
- [format.md](format.md) — entry format, section rules, good vs bad examples
- [templates/insights.md](templates/insights.md) — blank template for new module files
