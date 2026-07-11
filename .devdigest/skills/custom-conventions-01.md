# custom-conventions-01

Flag changes that violate any rule below and cite the offending `file:line`.

## architecture
**Rule:** Phase-tagged constants (e.g., [T1], [T2], [T3]) are used in comments to document feature rollout stages and dependencies across the codebase.
Detected in `server/src/modules/repo-intel/constants.ts:1`:

```
/**
```

**Rule:** Database schema is organized into domain-specific files under `./schema/` with a barrel export in `db/schema.ts` that re-exports all tables and provides a canonical `schema` object for Drizzle client typing.
Detected in `server/src/db/schema.ts:1`:

```
/**
```

**Rule:** Shared database column helpers are defined in `_shared.ts` and NOT re-exported by the public schema surface to keep them internal to the schema domain.
Detected in `server/src/db/schema/_shared.ts:1`:

```
import { timestamp } from 'drizzle-orm/pg-core';
```

**Rule:** Diff parsing is implemented as a pure function that returns a structured UnifiedDiff object with files, hunks, and line number tracking.
Detected in `server/src/adapters/git/diff-parser.ts:1`:

```
import type { UnifiedDiff, DiffHunk } from '@devdigest/shared';
```

## when not to flag
**Do NOT flag** a change if it is a pure, deterministic addition that introduces no I/O, no new external dependency, and no behavioral side effect (e.g., an early-return guard, a computed local variable, a pure helper call). Cite a rule above only when the diff actually changes architecture, file organization, or the public/internal boundary described in that rule — not merely because code was added near a rule's file.