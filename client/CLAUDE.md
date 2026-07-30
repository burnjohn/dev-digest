# client/ — @devdigest/web

Read `client/README.md` for route map, data flow diagram, and testing setup.

## Key conventions

- All pages are **server components** by default; interactive bits are **client components** inside `_components/`
- Data fetching: **TanStack Query** hooks in `src/lib/hooks/*` → `src/lib/api.ts`
- API base URL: `NEXT_PUBLIC_API_BASE` (default `http://localhost:3001`)
- Shared Zod contracts: `src/vendor/shared/` (path alias `@devdigest/shared`)
- UI primitives: `src/vendor/ui/` (path alias `@devdigest/ui`)
- i18n: `next-intl`, messages in `messages/<locale>/*.json`

## App structure

```
app/                              # Routes (server components)
  page.tsx                        # Root → redirect to first repo or onboarding
  onboarding/                     # Add first repo
  repos/[repoId]/pulls/           # PR list
  repos/[repoId]/pulls/[number]/  # PR detail: Diff · Findings · Overview
  agents/                         # Agent list + editor
  settings/[section]/             # API keys, models
components/                       # Shared chrome (AppShell, PageShell, …)
vendor/ui/                        # Kit primitives (TextInput, Modal, Drawer, …)
lib/                              # Providers, theme, toast, repo-context
```

## Testing

Tests are colocated (`*.test.tsx`) — vitest + jsdom, fetch mocked. No API or Docker needed.

## Session protocol

- **Start:** silently read `client/LEARNINGS.md` before responding — treat as high-confidence guidance.
- **End:** run `/engineering-insights` only if something substantial and new was found. If nothing non-obvious happened, write nothing. Before writing any entry, re-read LEARNINGS.md to avoid duplicates.

## Read when

- Route map + data flow → `client/README.md`
- Lessons and session learnings → `client/LEARNINGS.md`
- UI component specs → `client/specs/`
- Technical docs → `client/docs/`
