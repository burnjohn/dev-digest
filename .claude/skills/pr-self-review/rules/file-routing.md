# File Routing Rules

## How to assign files to buckets

After filtering noise (see SKILL.md Step 2), assign each remaining file to a bucket using these rules in order. A file can belong to only one bucket (first match wins), except Tests — test files are routed to Tests regardless of their module.

---

## Priority 0 — Tests (checked first, overrides all)

Any file matching `*.test.ts` or `*.test.tsx` anywhere in the repo → **Tests bucket**.

```
*.test.ts
*.test.tsx
```

---

## Priority 1 — UI Frontend

Files in `client/` that are NOT in `vendor/` and NOT test files:

```
client/src/app/**/*.ts         ✅
client/src/app/**/*.tsx        ✅
client/src/components/**/*.ts  ✅
client/src/components/**/*.tsx ✅
client/src/lib/**/*.ts         ✅
client/src/i18n/**/*.ts        ✅
client/src/**/*.css            ✅

client/src/vendor/**           ❌ skip (vendor)
client/src/test/**             ❌ skip (test setup, not test files)
```

---

## Priority 2 — Backend/Domain

Files in `server/` or `reviewer-core/` that are NOT test files:

```
server/src/**/*.ts             ✅
server/src/**/*.tsx            ✅
reviewer-core/src/**/*.ts      ✅
reviewer-core/src/**/*.tsx     ✅

server/src/vendor/**           ❌ skip (vendor — but contract sync is checked separately)
```

---

## Bucket summary

| File pattern                                      | Bucket         |
| ------------------------------------------------- | -------------- |
| `**/*.test.ts`, `**/*.test.tsx`                   | Tests          |
| `client/src/**/*.ts,tsx,css` (no vendor, no test) | UI Frontend    |
| `server/src/**/*.ts,tsx` (no vendor, no test)     | Backend/Domain |
| `reviewer-core/src/**/*.ts,tsx` (no test)         | Backend/Domain |
| Everything else                                   | **Skip**       |

---

## Contract sync (special case — not a bucket)

Always check, regardless of whether contracts/ appears in the diff:

```bash
diff -r client/src/vendor/shared/contracts/ server/src/vendor/shared/contracts/
```

If output is non-empty → CRITICAL finding (see severity-levels.md).
