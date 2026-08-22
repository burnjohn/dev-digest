# Folder Structure & Colocation

## Core Principle: Colocate First, Extract Later

Code that changes together lives together. Start everything inside the feature/page that uses it. Move up to a shared location only when a second feature needs it.

```
src/
  features/           ← feature modules (self-contained)
    auth/
      components/
      hooks/
      utils/
      constants.ts
      types.ts
      index.ts        ← public API of the feature
    payments/
      ...
  components/         ← shared UI (used by 2+ features)
    ui/               ← design system atoms (Button, Badge, Modal…)
    layout/           ← page wrappers, navbars, sidebars
  hooks/              ← shared hooks (used by 2+ features)
  utils/              ← shared generic utilities (used by 2+ features)
  constants/          ← global constants (app-wide)
  types/              ← global TypeScript types/interfaces
  lib/                ← third-party integrations & config (axios instance, query client…)
  pages/ (or app/)    ← route entry points — thin, only compose features
```

## Feature Module Rules

A feature is **self-contained**: deleting its folder must not break any other feature.

```
features/auth/
  components/
    LoginForm.tsx
    LoginForm.test.tsx       ← test colocated with component
  hooks/
    useAuth.ts
  api/
    auth.api.ts              ← API calls for this feature only
  constants.ts               ← constants for this feature only
  types.ts
  index.ts                   ← ONLY export what other features need
```

Rules:
- Features can import from `components/ui/`, `hooks/`, `utils/`, `lib/`
- Features MUST NOT import from other features (cross-feature coupling)
- If two features need the same thing, move it to `shared/` or `components/`
- `index.ts` is the public surface — internal files are private

## Colocation Threshold: When to Promote

| Scope | Location |
|---|---|
| Used by 1 component | Same file or same folder |
| Used by 1 feature | Inside `features/<name>/` |
| Used by 2+ features | `components/`, `hooks/`, or `utils/` at root |
| Used app-wide (config, env, routes) | `constants/`, `lib/`, `types/` at root |

**Never pre-optimize.** Start colocated. Refactor when the second consumer appears.

## Nesting Depth

- Maximum **3 levels** of nesting inside a feature folder
- Deeper nesting = sign the feature has grown into multiple features — split it
- Avoid `components/common/shared/base/` paths — they signal lost ownership

## Pages Are Thin

Route-level files (`page.tsx`, `index.tsx`) only compose features and pass props:

```tsx
// GOOD — page is a coordinator, no logic
export default function PaymentPage() {
  return (
    <PageLayout>
      <PaymentForm />
      <OrderSummary />
    </PageLayout>
  );
}

// BAD — page contains business logic
export default function PaymentPage() {
  const [card, setCard] = useState('');
  const handleSubmit = async () => {
    const res = await fetch('/api/pay', { body: JSON.stringify({ card }) });
    // ... 30 lines of logic
  };
  return <form onSubmit={handleSubmit}>...</form>;
}
```

## File Naming Conventions

| Type | Convention | Example |
|---|---|---|
| React component | PascalCase, `.tsx` | `UserCard.tsx` |
| Custom hook | camelCase, `use` prefix | `useUserProfile.ts` |
| Utility / helper | camelCase | `formatDate.ts` |
| Constants file | `constants.ts` or `SCREAMING_SNAKE.ts` | `constants.ts` |
| API module | `<domain>.api.ts` | `users.api.ts` |
| Types | `<domain>.types.ts` | `auth.types.ts` |
| Test | same name + `.test.tsx` | `UserCard.test.tsx` |
| Barrel | `index.ts` | `index.ts` |

## Barrel Files (`index.ts`)

Use barrels to define the public API of a feature or shared folder — not to re-export everything blindly.

```ts
// GOOD — selective, intentional public surface
export { LoginForm } from './components/LoginForm';
export { useAuth } from './hooks/useAuth';
export type { AuthUser } from './types';

// BAD — re-exports everything, destroys encapsulation
export * from './components/LoginForm';
export * from './hooks/useAuth';
export * from './utils/internal-helper'; // internal leaked out
```
