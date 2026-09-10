import type { SmartDiffRole } from "@devdigest/shared";

/** Dot color per role — visual only, no user-facing strings (those come
   from i18n, see SmartDiffViewer.tsx). Keyed by plain string literals
   rather than the shared zod enum, so nothing here depends on a runtime
   value from the @devdigest/shared barrel. */
export const ROLE_DOT_COLOR: Record<SmartDiffRole, string> = {
  core: "var(--accent)",
  wiring: "var(--warn)",
  tests: "var(--ok)",
  docs: "#a78bfa",
  boilerplate: "var(--text-muted)",
};

/** Fixed render order — matches the server's group ordering. */
export const ROLE_ORDER: SmartDiffRole[] = ["core", "wiring", "tests", "docs", "boilerplate"];
