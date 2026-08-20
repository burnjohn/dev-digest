# reviewer-core/specs

One file per engine change: `NN-feature-name.md`.

```markdown
# <Feature>

**Status:** draft | agreed | in progress | shipped

## Problem
## Prompt slots       <!-- new/changed section in assemblePrompt -->
## Public API         <!-- what src/index.ts starts exporting; who consumes it -->
## Grounding impact   <!-- does this change what survives the gate? -->
## Determinism        <!-- must stay reproducible under a stubbed LLMProvider -->
## Acceptance criteria
```

Two constraints every spec here must respect: the package stays **pure** (no DB,
GitHub, or filesystem), and the **grounding gate keeps its veto**. A spec that
needs either broken belongs in `../../server/specs/` instead.
