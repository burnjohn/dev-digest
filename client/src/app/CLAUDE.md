# client/src/app/CLAUDE.md

Next.js 15 App Router. Parent conventions in [../../CLAUDE.md](../../CLAUDE.md).

## Co-location rule

- Feature components live in `_components/<Name>/` **beside the page**, not in `src/components/`
- `src/components/` is for UI shared across multiple routes only
- Tests for a feature component live in the same `_components/<Name>/` folder

## RSC / Client boundary

- Pages are Server Components by default — keep them as RSC unless you need browser APIs or event handlers
- Data fetching goes in the Server Component; pass data as props to Client Components
- Add `"use client"` at the lowest possible level in the tree

## Next.js 15 gotcha

Route params are `Promise<{ id: string }>` — always `await params` before destructuring:

```ts
// correct
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
}
```

## Routes

| Segment | Purpose |
|---|---|
| `repos/[repoId]/pulls` | PR list for a repo |
| `repos/[repoId]/pulls/[number]` | PR detail (overview · diff · findings tabs) |
| `agents/[id]` | Agent editor |
| `settings/[section]` | API keys, model preferences |
| `onboarding` | Add new repository |

## See also

- [../lib/CLAUDE.md](../lib/CLAUDE.md) — hooks and API client conventions
