# PR Self-Review Skill — References

All sources and inspirations used to design this skill. Organized by topic.

---

## Orchestrator + Fan-out Agent Pattern

| Source                                | URL                                                                             | What it covers                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic — Building Effective Agents | https://www.anthropic.com/engineering/building-effective-agents                 | Orchestrator-workers workflow: central LLM breaks down task, delegates to worker sub-agents, synthesizes results. Core inspiration for the fan-out model |
| Anthropic — Parallelization workflow  | https://www.anthropic.com/engineering/building-effective-agents#parallelization | Sectioning: breaking task into independent parallel subtasks. Basis for "one sub-agent per bucket" decision                                              |
| Anthropic — Prompt Engineering Tools  | https://www.anthropic.com/engineering/building-effective-agents#appendix-2      | ACI (Agent-Computer Interface): tool definitions and instructions should be as carefully engineered as the overall prompt                                |

---

## Pre-push / Self-review Gate Concept

| Source                              | URL                                                                                                                                     | What it covers                                                                                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Git Hooks Official Docs             | https://git-scm.com/book/en/v2/Customizing-Git-Git-Hooks                                                                                | `pre-push` hook concept — running checks before push. Basis for PreToolUse(git push\*) hook design |
| Conventional Commits + CI Gates     | https://www.conventionalcommits.org/en/v1.0.0/                                                                                          | Idea of enforcing quality gates locally before changes reach CI                                    |
| GitHub — About pull request reviews | https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews | What a thorough PR review should cover — adapted for self-review automation                        |

---

## Structured Findings Format

| Source                            | URL                                                                                                                   | What it covers                                                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| ESLint Rule Output Format         | https://eslint.org/docs/latest/use/formatters/                                                                        | Structured linter output: file, line, severity, message, rule. Direct inspiration for `{file, line, severity, skill, issue, fix}` finding schema |
| GitHub Code Scanning SARIF Format | https://docs.github.com/en/code-security/code-scanning/integrating-with-code-scanning/sarif-support-for-code-scanning | Industry standard for structured security findings. SARIF: location + severity + message + fix                                                   |
| SonarQube Issue Format            | https://docs.sonarsource.com/sonarqube-server/latest/user-guide/issues/                                               | Severity levels (Blocker/Critical/Major/Minor/Info) and issue deduplication — adapted to CRITICAL/HIGH/MEDIUM                                    |

---

## Severity Classification

| Source                          | URL                                                                              | What it covers                                                                              |
| ------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| OWASP Severity Rating           | https://owasp.org/www-community/OWASP_Risk_Rating_Methodology                    | Risk-based severity classification. Basis for what qualifies as CRITICAL in security bucket |
| SonarQube — Blocker vs Critical | https://docs.sonarsource.com/sonarqube-server/latest/user-guide/issues/#severity | Blocker = must fix before release. Adapted: CRITICAL = blocks push                          |
| React Docs — Rules of Hooks     | https://react.dev/reference/rules/rules-of-hooks                                 | Authoritative source for what constitutes a React rules violation (CRITICAL tier)           |

---

## File Routing and Bucket Design

| Source                                | URL                                                                                 | What it covers                                                                         |
| ------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Bulletproof React — Project Structure | https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md | Feature-based folder structure — basis for how client/ and server/ buckets are defined |
| Feature-Sliced Design                 | https://feature-sliced.design/docs                                                  | Layer-based routing: which files belong to which architectural layer                   |

---

## Contract Sync Check

| Source                      | URL                               | What it covers                                                                                                          |
| --------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| API Contract Testing — Pact | https://docs.pact.io/             | Consumer-driven contract testing concept. Adapted: vendor/shared/contracts/ must stay in sync between client and server |
| OpenAPI Specification       | https://swagger.io/specification/ | Shared API contract as single source of truth between frontend and backend                                              |
