# Example: Type-Based → Feature-Based Migration

## Before — type-based `src/`

Everything grouped by *what kind of file it is*. Working on checkout means jumping through five folders, and it's not obvious from the tree which `utils/` functions are checkout-specific vs. actually shared.

```
src/
  components/
    CheckoutForm.tsx
    CheckoutSummary.tsx
    UserAvatar.tsx
    Button.tsx
    Modal.tsx
  hooks/
    useCheckout.ts
    useUserProfile.ts
  utils/
    formatCurrency.ts
    calculateDiscount.ts      # business rule, mislabeled as a "util"
    slugify.ts
    validateCheckoutForm.ts   # business rule, mislabeled as a "util"
  services/
    api.ts                    # every API call for the whole app, one file
  constants.ts                 # every constant for the whole app, one file
  types.ts                     # every type for the whole app, one file
```

Problems this creates as the app grows:
- `utils.ts` mixes generic helpers (`slugify`) with business rules (`calculateDiscount`) — the "would this change if a business rule changed?" test fails for two of the four "utils".
- `constants.ts` and `types.ts` become 500+ line files nobody wants to touch, and merge conflicts pile up because every feature's changes land in the same file.
- Deleting the checkout feature means hunting through all six top-level folders to find every related piece.

## After — feature-based, with a Next.js `app/`

```
src/
  app/                              # routing ONLY
    (shop)/
      checkout/
        page.tsx                   # composes features/checkout, no logic here
    dashboard/
      profile/
        page.tsx
  features/
    checkout/
      components/
        CheckoutForm.tsx
        CheckoutSummary.tsx
      hooks/
        useCheckout.ts             # state + orchestration
      services/
        checkoutService.ts         # calculateDiscount, validateCheckoutForm — business rules
      actions/
        createOrder.ts             # thin Server Action: auth -> validate -> DAL -> revalidate
      dal/
        orders.ts                  # the only file allowed to query the orders table
      types/
        checkout.types.ts
      constants.ts                 # checkout-specific constants only
    user-profile/
      components/
        UserAvatar.tsx
      hooks/
        useUserProfile.ts
      dal/
        users.ts
  components/
    ui/
      Button.tsx                   # genuinely reused across features
      Modal.tsx
  lib/
    formatCurrency.ts              # pure, generic — passes the "util" test
    slugify.ts
  shared/
    constants/
      pagination.ts                # used by 2+ unrelated features
    types/
      pagination.types.ts
```

What changed and why:
- `calculateDiscount` and `validateCheckoutForm` moved out of `utils/` into `checkout/services/` — they encode business rules, so the "utils vs. services" test (see [references/constants-utils-services.md](references/constants-utils-services.md)) puts them there, not in generic utils.
- `constants.ts` and `types.ts` split: feature-local constants/types stay inside the feature; only the ones two+ unrelated features actually need graduate to `shared/`.
- `app/` shrank to routing — the checkout `page.tsx` renders `<CheckoutForm />` from `features/checkout/components/`, it doesn't define what checkout *does*.
- A `dal/` folder appeared per feature, so `orders.ts` is the only code path allowed to touch the `orders` table — Server Actions and Server Components call into it instead of the ORM directly (see [references/nextjs-app-router-architecture.md](references/nextjs-app-router-architecture.md)).
- Deleting `features/checkout/` now removes the whole feature cleanly — nothing outside it depends on its internals.
