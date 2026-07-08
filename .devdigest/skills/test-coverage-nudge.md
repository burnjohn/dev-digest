# Test Coverage Nudge

For every non-trivial source file changed in the PR, verify a corresponding test file was also touched.

## Rule
- WARN when a src/ file is changed but no test/ or *.test.* file was touched.
- INFO when the changed code is configuration-only (no logic branches).
- Exempt: migrations, generated files, type-only changes.