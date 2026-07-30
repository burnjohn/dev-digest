Capture engineering insights from this session and write them to the appropriate LEARNINGS.md file(s).

Steps:
1. **Gate check** — assess session depth. If fewer than 3 user messages and no tools used and no errors encountered → write nothing, respond "nothing substantial to capture this session"
2. Identify which module(s) were touched (server/ · client/ · reviewer-core/ · e2e/) by checking which files were read or edited
3. Extract candidates in priority order:
   - User corrections (highest signal)
   - Failed approaches / dead ends
   - Repeated patterns
   - Error patterns with non-obvious root causes
   - Workflow observations, architectural decisions, tool quirks
4. For each candidate — anti-banality test: "Would this be obvious to anyone reading the code?" If yes, discard it
5. **Re-read the target LEARNINGS.md** — if the insight already exists in any form, skip it
6. For entries that pass: write as `**YYYY-MM-DD** · **[Task type]** · [actionable, specific, file:line] · Confidence: high/medium/low`
7. Append under the correct section heading — never edit existing entries
8. Report: list every entry written, or "nothing substantial to capture this session" if nothing passed the bar
