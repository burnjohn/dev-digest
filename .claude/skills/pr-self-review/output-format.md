# Output Format — PR Self Review

Always end your analysis with a YAML block in this exact format.
The shell script parses this block — do not change the structure.

## Format

```yaml
pr-self-review:
  status: BLOCKED        # BLOCKED if any critical finding exists, PASSED otherwise
  skills-applied:
    - onion-architecture
    - fastify-best-practices
    - security
  summary: "2 critical, 1 high, 3 medium findings across 5 files"
  findings:
    - id: 1
      severity: critical
      confidence: high
      skill: onion-architecture
      file: server/src/modules/pulls/routes.ts
      line: 42
      message: "Direct Drizzle query inside route handler"
      suggestion: "Move to PullsRepository and call via PullsService"

    - id: 2
      severity: high
      confidence: medium
      skill: fastify-best-practices
      file: server/src/modules/settings/routes.ts
      line: 18
      message: "Route body has no Zod schema — input arrives unvalidated"
      suggestion: "Add z.object({...}) schema and attach via schema: { body: ... }"

    - id: 3
      severity: medium
      confidence: high
      skill: react-best-practices
      file: client/src/app/repos/[repoId]/pulls/[number]/layout.tsx
      line: 31
      message: "useEffect missing dependency: repoId"
      suggestion: "Add repoId to the dependency array"
```

## Rules

- Always include the `pr-self-review:` top-level key
- `status` must be exactly `BLOCKED` or `PASSED` (uppercase)
- `findings` must be an array even if empty (`findings: []`)
- `line` is the first line of the problematic code block (use 0 if unknown)
- `suggestion` must be actionable — one concrete thing to do, not a description of the problem
- Skip findings where confidence is `low` (do not include them at all)
- Downgrade severity by one level for `medium` confidence findings before writing to output
- Do not include suppressed findings (`// pr-review: ignore` lines)

## After the YAML block

After the YAML block, write a short human-readable summary (3-5 lines max).
Mention the most important critical findings by file and line.
Do not repeat all findings — the YAML already has them.
