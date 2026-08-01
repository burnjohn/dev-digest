/**
 * `lineLabel` now lives in `lib/findings.ts` alongside the rollup helpers — the
 * severity counters and their popovers format the same line ranges, and two
 * copies would be one too many. Re-exported here so this component's imports
 * (and its tests) keep working.
 */
export { lineLabel } from "@/lib/findings";
