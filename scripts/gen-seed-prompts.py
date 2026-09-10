#!/usr/bin/env python3
"""Regenerate server/src/db/seed-prompts.ts from docs/agent-prompts/*.md."""
import pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
docs = root / "docs/agent-prompts"
order = [("GENERAL_REVIEWER_PROMPT","general-reviewer"),("SECURITY_REVIEWER_PROMPT","security-reviewer"),
 ("PERFORMANCE_REVIEWER_PROMPT","performance-reviewer"),("TEST_QUALITY_REVIEWER_PROMPT","test-quality-reviewer"),
 ("API_INTEGRATION_REVIEWER_PROMPT","api-integration-reviewer"),("DATA_SCHEMA_REVIEWER_PROMPT","data-schema-reviewer"),
 ("UI_REVIEWER_PROMPT","ui-reviewer"),("DOCS_SPEC_REVIEWER_PROMPT","docs-spec-reviewer"),
 ("SPEC_CONFORMANCE_REVIEWER_PROMPT","spec-conformance-reviewer")]
out = ["/**"," * Built-in reviewer system prompts used by the seed."," *",
" * GENERATED from `docs/agent-prompts/*.md` — edit the markdown, then re-run",
" * `python3 scripts/gen-seed-prompts.py`. The DB row is the source of truth at run",
" * time; editing a prompt here only affects freshly seeded workspaces. See",
" * `docs/agent-prompts/README.md` for the severity/verdict conventions."," */",""]
for const, f in order:
    body = (docs / f"{f}.md").read_text().strip()
    body = re.sub(r"^<!--.*?-->\s*", "", body, flags=re.S)
    body = body.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
    out.append(f"export const {const} = `{body}`;\n")
(root / "server/src/db/seed-prompts.ts").write_text("\n".join(out))
print("seed-prompts.ts regenerated")
