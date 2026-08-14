# docs/skills — importable skill examples

Skills that are **not** seeded. They exist as files so the import path gets
exercised on a real skill instead of a throwaway, and so there is something on
disk to hand to someone who wants to try the feature.

Everything under `server/src/db/seed-skills.ts` is created directly in the
database on `pnpm db:seed`. Everything here has to come in through
**Skills → Add Skill → Import from file**.

## What's here

| Skill | Used by | Why it is not seeded |
| --- | --- | --- |
| `flaky-test-gate/` | Test Quality Reviewer | The archive case: it carries an `install.sh` the extractor must list and never read. |

## Importing it

As a single file:

```sh
# Skills → Add Skill → Import from file → pick this
docs/skills/flaky-test-gate/SKILL.md
```

As an archive, which is the more interesting path:

```sh
cd docs/skills && zip -r /tmp/flaky-test-gate.zip flaky-test-gate
```

Then import `/tmp/flaky-test-gate.zip`. The preview will show:

- the body read from `flaky-test-gate/SKILL.md`, with the name, description and
  type taken from its frontmatter;
- `flaky-test-gate/install.sh` under **1 entry ignored**.

The script is listed by name only. It is never decompressed — the extractor's
per-entry filter runs before inflation — and never written to disk or executed.

## After importing

An imported skill is stored **disabled**, whatever the form says. Its body goes
into an agent's prompt as instructions, not as quoted data, so nothing but a
person reading it stands between a downloaded file and the model. Open it, read
it, then enable it and attach it to **Test Quality Reviewer**.

See `specs/01-skills.md` for why the body is not delimiter-fenced.
