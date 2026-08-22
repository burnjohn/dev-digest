# Spec: groundFindings()

Formal specification for the grounding gate.

## Purpose

Prevent hallucinated findings from reaching the database. A finding is only valid if it references real content from the diff. The grounding gate is the enforcement point.

## Algorithm

```
function groundFindings(findings: RawFinding[], diff: string): Finding[]

for each finding in findings:
  1. Take finding.diffQuote (string the LLM claims to have found in the diff)
  2. Normalize: trim whitespace, collapse internal runs of spaces
  3. Search diff for the normalized quote using exact substring match
  4. If NOT found:
       → discard finding entirely
       → do not include in output
  5. If found:
       → record the line number of the match within the diff
       → attach matched line number to finding
       → include in output

after filtering:
  → recompute score based on surviving findings
```

## Score Recomputation

Score is computed from the severity distribution of surviving findings:

| Severity | Weight |
|----------|--------|
| `critical` | 25 |
| `high` | 15 |
| `medium` | 7 |
| `low` | 3 |
| `info` | 1 |

```
rawScore = sum(weight[finding.severity] for finding in groundedFindings)
score = max(0, 100 - rawScore)
```

If all findings are dropped (100% hallucinated), score = 100 and verdict is overridden to `"approved"`.

## What Counts as a Match

- Exact substring match after normalization (whitespace collapsing)
- Case-sensitive
- The match must occur in a `+` or `-` line of the diff (context lines excluded)
- Minimum `diffQuote` length: 4 characters (single-char quotes are rejected as too vague)

## What Does NOT Count

- Line numbers alone (LLM provides a number but `diffQuote` is empty or too short) → rejected
- Quotes that only appear in the diff header (`--- a/file`, `+++ b/file`) → rejected
- Quotes from removed lines (`-`) are allowed (finding may reference what was deleted)

## Invariants

- `groundFindings()` is always called, even if the LLM returns zero findings
- The function is pure: same diff + same findings → same output, no side effects
- Never called with a partially-constructed diff — the full unified diff string must be passed

## Test Fixtures

Test cases covering edge cases live in `src/__tests__/grounding.test.ts`:
- Perfect match → retained
- Off-by-one whitespace → retained (after normalization)
- Hallucinated quote → dropped
- Empty `diffQuote` → dropped
- Quote in file header only → dropped
- All findings hallucinated → score = 100, verdict = "approved"
