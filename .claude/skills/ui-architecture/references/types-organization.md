# Types Organization (TypeScript)

Types follow the exact same colocation gradient as components, constants, and utils — resist the urge to create a global `types/` dumping ground on day one.

## The three tiers

1. **Inline**, in the file that uses it — for a type used exactly once (e.g. a component's own props).
2. **Colocated** `<name>.types.ts` inside a feature — once a type is shared by a few files within the same feature (e.g. a `Checkout` domain type used by both a component and a hook in `features/checkout/`).
3. **`shared/types/`** — only once a type is genuinely needed by *unrelated* features. Promoting too early creates a central file that couples features together for no reason; promoting too late means duplicated/drifting type definitions. When in doubt, start colocated — promoting later is a cheap move-and-import, demoting is the annoying direction.

## Practical notes

- Export both the type and, if it's derived from a runtime schema (e.g. Zod), the schema itself — don't hand-maintain a parallel manual type when it can be inferred.
- A feature's `types/` subfolder holds only that feature's types; `shared/types/` holds only genuinely cross-feature types (e.g. a `User` or `Pagination` type used everywhere). Don't let one absorb the other over time — if a "shared" type is only used by one feature again, move it back.
- The goal isn't a perfectly clean taxonomy — it's making sure the next person (or you, in six months) can find a type without grepping the whole repo.

## Sources

- [Wisp CMS — How to Organize Types in a React Project](https://www.wisp.blog/blog/how-to-organize-types-in-a-react-project)
