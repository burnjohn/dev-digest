# Running the DevDigest review Action on your fork

The runner is a Node GitHub Action (`agent-runner/action.yml` → `dist/index.js`)
that runs the `reviewer-core` engine on each pull request and posts a review.

## What to put in your repo

```
.github/workflows/devdigest-review.yml   ← copy from examples/devdigest-review.yml
.devdigest/agents/security-reviewer.yaml  ← the agent manifest (see fixtures/)
.devdigest/skills/secret-gate.md          ← skill bodies referenced by the agent
agent-runner/dist/index.js                ← committed bundle (npm run package)
```

A ready agent + skill live in `agent-runner/fixtures/` — copy them to
`.devdigest/` at your repo root, or point `devdigest-dir` at another path.

## One-time setup

1. **Build + commit the bundle** (the Action runs the committed `dist/`):
   ```bash
   cd agent-runner && npm install && npm run package
   git add agent-runner/dist && git commit -m "build: agent-runner bundle"
   ```
2. **Add the secret**: repo → Settings → Secrets and variables → Actions →
   `OPENROUTER_API_KEY`. (`GITHUB_TOKEN` is provided automatically.)
3. **Commit** the workflow + `.devdigest/` files, open a PR from a branch in
   your own fork, and watch the **Actions** tab. The review is posted on the PR;
   `devdigest-result.json` is uploaded as the `devdigest-result` artifact.

## Inputs

| input  | default         | meaning                                          |
|--------|-----------------|--------------------------------------------------|
| agent  | —               | agent slug → `.devdigest/agents/<slug>.yaml`     |
| agents | —               | multiple slugs, one per line (overrides `agent`) |
| all    | `false`         | run every agent in `.devdigest/agents`           |
| post   | `github-review` | `github-review` or `none` (dry run)              |

> External-fork PRs have no secrets by design — the run still computes findings
> but cannot post. For the course (you own your fork) this never applies.
