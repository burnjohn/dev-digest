# Enforcing import boundaries in CI

Structure is a wish until a linter enforces it. Folder names stop nobody, `index.ts` files do not
block deep imports, and review catches boundary violations only when the reviewer happens to look
at the import block.

The config below was **verified empirically** (see [Verification](#verification)), not copied from
a blog post. Versions used: `eslint@9.39`, `eslint-plugin-boundaries@7.2`,
`eslint-plugin-import@2.32`, `eslint-import-resolver-typescript@4.4`, `typescript-eslint@8`.

---

## Install

```bash
npm i -D eslint eslint-plugin-boundaries eslint-plugin-import eslint-import-resolver-typescript typescript-eslint
```

## `eslint.config.mjs`

```js
import boundaries from 'eslint-plugin-boundaries'
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript'
import importPlugin from 'eslint-plugin-import'
import tseslint from 'typescript-eslint'

export default [
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
    plugins: { boundaries, import: importPlugin },
    settings: {
      // Required, and easy to miss: without it eslint-plugin-import cannot read .ts/.tsx
      // files and rules like import/no-cycle silently pass on real violations.
      'import/parsers': { '@typescript-eslint/parser': ['.ts', '.tsx'] },
      // Legacy key — this is the one eslint-plugin-boundaries reads.
      'import/resolver': { typescript: { alwaysTryTypes: true } },
      // Flat-config key — this is the one eslint-plugin-import reads. Both are needed.
      'import/resolver-next': [
        createTypeScriptImportResolver({ alwaysTryTypes: true, project: './tsconfig.json' }),
      ],

      // Classify every file into exactly one architectural element.
      'boundaries/elements': [
        { type: 'route',     pattern: 'src/app/*',        capture: ['segment'] },
        { type: 'shared-ui', pattern: 'src/components/*', capture: ['name'] },
        { type: 'lib',       pattern: 'src/lib' },
        { type: 'server',    pattern: 'src/server' },
      ],
    },
    rules: {
      'boundaries/dependencies': [2, {
        default: 'disallow', // deny by default; every allowed edge is written down below
        message: '{{from.element.type}} must not import {{to.element.type}}',
        policies: [
          // routes may use shared code and the server DAL
          { from: { element: { type: 'route' } },
            allow: { to: { element: { types: { anyOf: ['shared-ui', 'lib', 'server'] } } } } },

          // a route may import within itself (its own _components, _lib)
          { from: { element: { type: 'route' } },
            allow: { to: { element: { type: 'route',
              captured: { segment: '{{from.element.captured.segment}}' } } } } },

          // ...but never from a different route
          { from: { element: { type: 'route' } },
            disallow: { to: { element: { type: 'route',
              captured: { segment: '!{{from.element.captured.segment}}' } } } },
            message: 'Route "{{from.element.captured.segment}}" must not import from route ' +
                     '"{{to.element.captured.segment}}" — promote the shared piece instead' },

          // shared code never reaches upward into routes
          { from: { element: { type: 'shared-ui' } },
            allow: { to: { element: { types: { anyOf: ['shared-ui', 'lib'] } } } } },
          { from: { element: { type: 'lib' } },
            allow: { to: { element: { type: 'lib' } } } },
          { from: { element: { type: 'server' } },
            allow: { to: { element: { types: { anyOf: ['lib', 'server'] } } } } },

          // public API without barrel files: only the element's entry file is importable
          { disallow: { to: { element: { type: 'shared-ui', fileInternalPath: '!index.*' } } },
            message: 'Import "{{to.element.type}}" through its entry point, not its internals' },
        ],
      }],

      'import/no-cycle': [2, { maxDepth: '∞' }],
      'no-restricted-imports': [2, { patterns: [{
        group: ['../../*'],
        message: 'Use the @/ alias across modules; relative paths stay inside one module.',
      }] }],
    },
  },
]
```

Requires `@/*` → `src/*` in `tsconfig.json` `compilerOptions.paths`.

---

## The entry-point rule replaces barrel files

The last policy is the one that makes "no barrel files" safe. A barrel exists to say *this is the
module's public API*; it enforces nothing (anyone can still deep-import) and costs module graph
size at runtime. The lint rule enforces exactly that intent at zero runtime cost:
`src/components/button/index.ts` is importable, `src/components/button/button-internals.ts` is not.

If a module genuinely has several entry points, widen the pattern
(`fileInternalPath: '!{index.*,public-*.ts}'`) instead of adding a barrel.

---

## Version note

`eslint-plugin-boundaries` v7 **deprecated** the rules most tutorials still show:

| Deprecated (v6 and earlier) | Use instead |
|---|---|
| `boundaries/element-types` | `boundaries/dependencies` |
| `boundaries/entry-point` | `boundaries/dependencies` with a `fileInternalPath` selector |
| `boundaries/external` | `boundaries/dependencies` with a `module` selector |
| `boundaries/no-private` | `boundaries/dependencies` with `dependency.relationship` |
| `rules:` option inside the rule config | `policies:` |
| `mode: 'folder'` in an element descriptor | omit it (now the default) |
| `mode: 'full'` | `partialMatch: false` |
| `mode: 'file'` | a `boundaries/files` descriptor |

Also available and worth adding once the element list is complete:
`boundaries/no-unknown-files` (a file matching no element is usually a placement mistake),
`boundaries/no-unknown-dependencies`, `boundaries/no-ignored-dependencies`.

---

## The lighter alternative: `import/no-restricted-paths`

If a full element taxonomy is more than the project needs, `eslint-plugin-import` alone enforces
the direction (this is what bulletproof-react recommends):

```js
'import/no-restricted-paths': [2, { zones: [
  // shared code must not import from routes
  { target: './src/components', from: './src/app' },
  { target: './src/lib',        from: './src/app' },
  // the client must not import the server DAL directly
  { target: './src/components', from: './src/server' },
] }],
```

It cannot express "route A must not import route B" generically — each pair needs its own zone —
which is the point at which `boundaries/dependencies` pays for itself.

---

## Monorepo variant (Nx)

Folder patterns stop at the package boundary. Nx tags each project on two axes and enforces
constraints between them, which is the same rule expressed one level up:

```jsonc
// project.json (per package)
{ "tags": ["scope:reviews", "type:feature"] }
```

```js
'@nx/enforce-module-boundaries': [2, { depConstraints: [
  { sourceTag: 'type:app',     onlyDependOnLibsWithTags: ['type:feature', 'type:ui', 'type:util'] },
  { sourceTag: 'type:feature', onlyDependOnLibsWithTags: ['type:ui', 'type:util'] },
  { sourceTag: 'type:ui',      onlyDependOnLibsWithTags: ['type:ui', 'type:util'] },
  { sourceTag: 'type:util',    onlyDependOnLibsWithTags: ['type:util'] },
  { sourceTag: 'scope:reviews', onlyDependOnLibsWithTags: ['scope:reviews', 'scope:shared'] },
  { sourceTag: 'scope:repos',   onlyDependOnLibsWithTags: ['scope:repos', 'scope:shared'] },
] }],
```

The `type:` axis is the layer direction; the `scope:` axis is the feature isolation. Both are the
same two rules from SKILL.md §5.

---

## Rollout on an existing codebase

A rule that fails 400 times gets disabled the same day. Land it in this order:

1. Add the config with every rule at `warn`. Count violations per rule.
2. Fix or `eslint-disable-next-line` each existing violation with a `TODO` and an owner. A
   grandfathered violation that is *recorded* is fine; an unrecorded one is a slow leak.
3. Flip to `error` and add ESLint to CI in the same commit, so no new violation can land.
4. Burn down the disables. The count only goes down.

---

## Verification

The config above was tested against a fixture with a deliberately illegal import graph
(`src/app/dashboard/`, `src/app/settings/`, `src/components/button/{index,button}.tsx`,
`src/lib/`, `src/server/`). Results:

| Case | Expected | Actual |
|---|---|---|
| `app/settings/page.tsx` imports `app/dashboard/_components/chart` | error | ✅ "Route settings must not import from route dashboard" |
| `app/settings/page.tsx` imports `components/button/button` (internal) | error | ✅ "Import through its entry point, not its internals" |
| `components/bad/index.tsx` imports a route | error | ✅ "shared-ui must not import route" |
| `import { clamp } from '../../lib/utils'` | error | ✅ `no-restricted-imports` |
| two modules importing each other | error | ✅ `import/no-cycle` |
| the legal tree (route → shared entry point, route → lib, route → server) | clean | ✅ exit 0, no errors |

The last row matters as much as the others: a config that fires on everything gets deleted just as
fast as one that fires on nothing.

**The `import/parsers` setting was the difference between working and silently passing.** Without
it, `import/no-cycle` reported nothing on a real cycle. If a rule here seems to do nothing, verify
it against a deliberate violation before trusting it.
