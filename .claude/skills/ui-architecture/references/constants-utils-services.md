# Constants, Utils, Services & Business Logic

## Constants

Follow the same colocation gradient as everything else:

1. Used in one file → define it right there, at module scope (not inside the component body, so it isn't recreated every render).
2. Used across a feature → a colocated `constants.ts` inside that feature's folder.
3. Used across unrelated features → `shared/constants/`, **split by topic** (`shared/constants/pagination.ts`, `shared/constants/roles.ts`) rather than one catch-all `constants.ts` that becomes unreadable and merge-conflict-prone.

Naming: `UPPER_SNAKE_CASE` for the constant itself. This is a near-universal convention — it's the fastest visual signal in a diff or review that a value is a fixed, non-reactive constant rather than state or a prop.

Source: [Semaphore — How To Organize Constants in a Dedicated Layer](https://semaphore.io/blog/constants-layer-javascript).

## Utils vs. Helpers vs. Services vs. Lib

These four words get used inconsistently across codebases, which is exactly why "just put it in utils" becomes a habit that turns `utils/` into an unstructured dumping ground over time. A workable, widely-used distinction:

| Folder | Contains | Example |
|---|---|---|
| `utils/` | Pure, stateless, generic functions with **zero business rules** | `formatDate`, `slugify`, `debounce` |
| `helpers/` | In most codebases, a synonym for `utils/` — pick one term and use it consistently rather than maintaining both | `stringHelpers`, `dateHelpers` |
| `services/` / `api/` | **Business logic**: API calls, domain rules, anything that encodes "what our app does" rather than "how to transform this value" | `checkoutService.submitOrder()`, `userService.updateProfile()` |
| `lib/` | Thin wrappers/configuration around **external** libraries or SDKs | a configured Axios instance, a Stripe client wrapper |

The test that matters more than the folder name: **would this function need to change if a business rule changed?** If yes, it's a service, not a util. `formatCurrency(amount, locale)` is a util. `calculateDiscountedPrice(cart, promoCode)` is business logic and belongs in a service, even though both "just return a number."

Sources: [Lib vs Utils vs Services Folders (Ali Bey)](https://medium.com/@a.m.housen/libs-vs-utils-vs-services-folders-simple-explanation-for-developers-0ae961539a0f), [Are utils a code smell? (dev.to)](https://dev.to/noway/are-utils-folder-where-you-put-random-stuff-you-don-t-know-where-to-put-otherwise-a-code-smell-3054).

## Where business logic goes: hooks, not components

Business logic — state, side effects, API orchestration, validation — never lives directly in a component's body. It's extracted into:

- **Custom hooks** (`hooks/useCheckout.ts`) when it's stateful and specific to how a piece of UI behaves. React's own docs frame this well: a hook lets a component "express your intent, not the implementation" — the component calls `useCheckout()` and stays declarative.
- **Services** (`services/checkoutService.ts`) when it's the underlying business rule or API call itself, independent of any particular component using it. A hook typically *calls* a service, not the other way around.

This split is what keeps components "dumb": once logic moves out, a component's job shrinks to *rendering what a hook/service gives it*, which is also what makes it trivially testable and reusable.

One hook, one responsibility — split `useCheckout` into `useCheckout` + `usePromoCode` if it's doing two unrelated jobs. Side effects belong inside `useEffect`, not smuggled into a return value or triggered as a side effect of render.

Sources: [React Docs — Reusing Logic with Custom Hooks](https://react.dev/learn/reusing-logic-with-custom-hooks), [React Docs — You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect), [Custom Hooks in React: Streamlining Business Logic (Siddarth Bulusu)](https://siddarth-bulusu.medium.com/custom-hooks-in-react-streamlining-business-logic-for-cleaner-code-af9425244098).

## In Next.js specifically

The same "services hold business logic" idea has a stricter, named form in Next.js App Router: the **Data Access Layer**. See [nextjs-app-router-architecture.md](nextjs-app-router-architecture.md) — the short version is that `services/`-style business logic sits on top of a DAL that is the only code allowed to touch the database.
