# Client Gotchas

## `@devdigest/shared` is not an npm package

The alias resolves to `../server/src/vendor/shared` via `tsconfig.json` paths. There is no `node_modules/@devdigest/shared`. If the alias breaks (e.g., after a TS config change), you will see `Cannot find module '@devdigest/shared'` — fix the `paths` entry, not the import.

## `fetch` is mocked globally in tests — no API server needed

`src/test/setup.ts` replaces `global.fetch` with a vitest mock before any test runs. Test files that need specific responses call `vi.mocked(fetch).mockResolvedValueOnce(...)`. Never spin up a real API server for client unit tests.

## SSE hook closes on `completed` or `failed` — not on unmount alone

`useRunEvents` closes the `EventSource` when it receives a terminal event (`completed` / `failed`) OR when the component unmounts. If the component unmounts before the review finishes, the stream closes and events are lost. The parent component should keep the subscription mounted until the run terminates.

## API keys are masked in `GET /settings` responses

The settings endpoint never returns full API key values — only masked strings (e.g., `sk-...abc`). Do not try to pre-fill key input fields from the response. Always treat key fields as write-only on the client.

## next-intl requires both server and client providers

`next-intl` needs `NextIntlClientProvider` at the layout level and `getTranslations` / `useTranslations` inside components. If you add a new message namespace, also add it to the `messages/*.json` files — missing keys render as the key string, not an error.

## TanStack Query cache is not persisted across page reloads

There is no `QueryClient` persistence configured. A hard reload clears all cache. Do not design UI that relies on cache surviving navigation — use `initialData` from RSC props for critical above-the-fold content.
