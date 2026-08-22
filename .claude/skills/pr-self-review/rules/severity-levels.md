# Severity Levels

## Overview

Three levels. Only CRITICAL blocks the merge gate.

| Level | Label        | Blocks push?             |
| ----- | ------------ | ------------------------ |
| 🔴    | **CRITICAL** | ✅ YES — fix before push |
| 🟡    | **HIGH**     | ❌ No — recommendation   |
| 🔵    | **MEDIUM**   | ❌ No — recommendation   |

---

## 🔴 CRITICAL — what qualifies

A finding is CRITICAL only if it meets one of these exact conditions:

### 1. React Best Practices — critical violations

- Business logic (calculations, transformations, conditions) implemented directly inside JSX or component body instead of a hook or service
- Rules of Hooks violated (hook called conditionally, inside a loop, or after an early return)
- `useEffect` with a missing or incorrect dependency array that causes infinite loops or stale data

### 2. Security — high confidence findings

- Secret, token, API key, or password hardcoded in source code (not `.env`)
- User input rendered as raw HTML without sanitization (XSS)
- SQL query built via string concatenation with unsanitized input
- `eval()` or `new Function()` called with user-controlled input
- `dangerouslySetInnerHTML` used with unsanitized data

### 3. Onion Architecture — layer violation

- Direct database query (Drizzle/SQL) inside a controller or route handler — must go through repository layer
- Infrastructure concern (HTTP client, file system, external API) called directly from domain/use-case layer
- Domain entity imported directly into a controller (bypassing use-case/service layer)

### 4. DevDigest shared contract — out of sync

- Files in `client/src/vendor/shared/contracts/` differ from `server/src/vendor/shared/contracts/`
- Any contract file modified in only one location

### 5. npm audit — high/critical vulnerability

- A dependency in `package.json` has a known `high` or `critical` severity vulnerability per `npm audit`

---

## 🟡 HIGH — what qualifies

- Component exceeds 200 lines and mixes rendering + state + side effects
- Custom hook exceeds 100 lines without decomposition
- Fetch/async call inside a component without error handling or loading state
- Zod validation missing at a module boundary (API route input, Server Action input)
- Missing error boundary around a route segment that can throw
- TypeScript `any` used in a public function signature or exported type
- **Test coverage gate:** changed component file has no corresponding updated test file (HIGH, not CRITICAL)
  - Skip for: `lib/`, `i18n/`, `vendor/`, `contexts/`, `utils/`, `constants/`, `types/`, Next.js pages (`page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`)
  - Skip if fewer than 20 lines changed in the file (minor edits unlikely to break existing tests)
  - Downgrade to MEDIUM if the file is newly created (Added, not Modified)

---

## 🔵 MEDIUM — what qualifies

- File or folder name does not follow project naming conventions (kebab-case folders, PascalCase components)
- Constant hardcoded inline in JSX/template that belongs in `constants.ts`
- Utility function duplicated across modules (same logic exists elsewhere)
- Missing `abort controller` / cleanup in `useEffect` with a fetch
- TypeScript `as` cast used instead of proper type guard
- Test file missing `describe` block or uses hardcoded magic values without constants
- **Deep relative import** used instead of `@/` alias (e.g. `../../../components/Foo` instead of `@/components/Foo`) — applies to `client/` files only

---

## When in doubt

If unsure between CRITICAL and HIGH → use HIGH.
If unsure between HIGH and MEDIUM → use MEDIUM.
Prefer false negatives on CRITICAL over false positives — CRITICAL blocks the push.
