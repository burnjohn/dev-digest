/**
 * Read a case's colocated fixtures. Pass `import.meta.url` from a *.cases.ts file and get back
 * a reader scoped to that file's `fixtures/` directory — so case data can inline raw inputs
 * (diffs, code, session traces) without repeating path plumbing.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export function fixtureReader(metaUrl: string): (name: string) => string {
  const dir = join(dirname(fileURLToPath(metaUrl)), "fixtures");
  return (name: string) => readFileSync(join(dir, name), "utf8");
}
