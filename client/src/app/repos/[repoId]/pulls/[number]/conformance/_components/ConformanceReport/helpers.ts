import type { ConformanceItem } from "@devdigest/shared";
import { STATUS_IMPLEMENTED, STATUS_MISSING, STATUS_OUT_OF_SCOPE } from "./constants";

/** Partition conformance items into the three report columns. */
export function partitionItems(items: ConformanceItem[]): {
  implemented: ConformanceItem[];
  missing: ConformanceItem[];
  creep: ConformanceItem[];
} {
  return {
    implemented: items.filter((i) => i.status === STATUS_IMPLEMENTED),
    missing: items.filter((i) => i.status === STATUS_MISSING),
    creep: items.filter((i) => i.status === STATUS_OUT_OF_SCOPE),
  };
}
