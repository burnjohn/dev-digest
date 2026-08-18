# reviewer-core/ purity: the injected-port pattern

`reviewer-core/` is DevDigest's already-existing gold-standard example of an Onion
Architecture domain core. Both its README and `reviewer-core/CLAUDE.md` state the
rule as a hard contract, not a suggestion:

> "Purity is the contract. No database, no GitHub, no filesystem. The only side
> effect is an LLM call through an injected `LLMProvider`. Anything that needs I/O
> belongs in `server/`, not here."

## Structure

```
reviewer-core/src/
├── index.ts               # public API barrel — the only sanctioned import surface
├── prompt.ts               # pure: prompt assembly + injection-fencing
├── grounding.ts             # pure: mechanical citation-grounding gate, no I/O
├── review/
│   ├── run.ts                # the one impure edge — calls the injected LLMProvider
│   └── reduce.ts              # pure: map-reduce merge of partial reviews
├── llm/
│   ├── openrouter.ts           # the ONE concrete adapter (I/O) — kept physically separate
│   └── structured.ts            # pure: Zod → JSON-Schema + parse-with-repair
└── output/to-review.ts        # pure: Review → GitHubReviewPayload transform
```

## The pattern

`review/run.ts`'s `reviewPullRequest()` takes an `LLMProvider` as a parameter and
calls it — `input.llm.completeStructured<Review>(...)` — rather than importing a
concrete provider. Everything else in the package (`prompt.ts`, `grounding.ts`,
`reduce.ts`, `to-review.ts`) is pure functions over data with zero I/O. Domain
contracts (`Review`, `Finding`, `Verdict`) are imported from `@devdigest/shared`, not
redefined locally.

This is dependency inversion at the smallest possible scale: the domain (`run.ts`)
declares what it needs (`LLMProvider`, an interface owned by `@devdigest/shared`),
and the concrete implementation (`llm/openrouter.ts`) is supplied from outside — in
this case, by whatever calls `reviewPullRequest()` in `server/`.

## Applying this pattern to new reviewer-core code

When adding a new pure function or extending the review pipeline:

1. If it doesn't need I/O, write it as a pure function taking plain data in and
   returning plain data out — no imports of `fs`, `net`, database clients, or
   concrete adapter classes.
2. If it needs an external system, accept that system as an **injected parameter**
   typed by an interface (mirror `LLMProvider`), not as a direct import of a concrete
   class. The concrete implementation stays in `reviewer-core/src/llm/` (or a
   sibling folder for a new external system) and is wired up by the caller in
   `server/`.
3. Contracts for whatever the function accepts/returns come from `@devdigest/shared`
   first — don't invent a parallel local type when a contract already exists.

## Reading

- [Implementing the Onion Architecture in Node.js with TypeScript and InversifyJS](https://dev.to/remojansen/implementing-the-onion-architecture-in-nodejs-with-typescript-and-inversifyjs-10ad) — same injected-interface pattern, with a DI container instead of a plain function parameter
- [DDD, Hexagonal, Onion, Clean, CQRS... How I put it all together](https://herbertograca.com/2017/11/16/explicit-architecture-01-ddd-hexagonal-onion-clean-cqrs-how-i-put-it-all-together/) — "ports" as the interface the domain owns, "adapters" as the implementation supplied from outside
