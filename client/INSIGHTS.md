# Insights — client

Running log of non-obvious findings, decisions, and gotchas for `@devdigest/web`.
Append newest at the top. Keep entries short: what surprised you, why it is that
way, and what to do about it. [CLAUDE.md](CLAUDE.md) stays lean by pointing here.

<!-- Format: ### YYYY-MM-DD — short title, then 1–3 lines. -->

### 2026-08-09 — seed
- **All server data flows through `lib/hooks/*` → `lib/api.ts`.** If you're writing
  a `fetch` inside a component, stop — add/extend a hook instead.
- **Pages are thin**; the real logic lives in colocated `_components/<Name>/`.
- **Tests never hit the network** — `fetch` is mocked under jsdom, so mock the hook
  boundary, not global `fetch`, when a test needs data.
