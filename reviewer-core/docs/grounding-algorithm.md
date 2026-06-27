# Grounding Algorithm

`groundFindings()` in `src/grounding.ts` is the mandatory citation gate — every finding must
prove it references real diff content before it is accepted into the final review.

## Why grounding exists

LLMs hallucinate file paths and line numbers. Without a mechanical verification step, a finding
that claims `src/foo.ts:42` may reference a line that doesn't exist in the diff, making the
review comment point at nothing. Grounding prevents ghost citations from reaching users.

## Citation requirement

Each finding must supply a `citation` object with:
- `filePath` — the path as it appears in the diff header (`--- a/src/foo.ts`)
- `lineNumber` — a line number that falls within a changed hunk in that file

`groundFindings()` iterates every finding, looks up `filePath` in the parsed diff, then checks
whether `lineNumber` falls inside any `+` or `-` hunk range. If it doesn't match, the finding
is dropped.

## Full-file finding kinds (whitelist)

Some finding kinds legitimately apply to an entire file rather than a specific line
(e.g., missing license header, wrong file location). These bypass the line-number check but
still require the `filePath` to exist in the diff:

```
'missing-test-file' | 'wrong-file-location' | 'file-level-concern'
```

Adding a new full-file kind requires an explicit entry in the whitelist in `grounding.ts` —
there is no wildcard or dynamic mechanism.

## Score recomputation

After grounding, the score is recomputed from the **surviving** findings only:

```
groundedScore = 1 - (criticalCount * 0.3 + warningCount * 0.1 + suggestionCount * 0.03)
groundedScore = max(0, min(1, groundedScore))
```

The LLM's own score field is discarded entirely. This makes the score a deterministic function
of the grounded findings — an LLM cannot inflate or deflate its score by lying about findings.

## Grounding summary string

`groundFindings()` returns a summary string in the format `"N/M passed"` where N is the
number of accepted findings and M is the total. This string is stored on the run record and
displayed in the UI run card.

## Invariant

`groundFindings()` must never be bypassed. If a new code path skips it, the score and the
citation guarantee both break simultaneously. Any new finding type that cannot provide a
`filePath` + `lineNumber` must be added to the full-file whitelist, not exempt from grounding.
