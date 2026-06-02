/** Parse a CSV query-param value, keeping only members of the allowed set. */
export function parseCsv<T extends string>(v: string | null, all: T[]): T[] {
  if (!v) return [];
  return v.split(",").filter((x) => (all as string[]).includes(x)) as T[];
}

/** Toggle a value within a multi-select list, returning the next list. */
export function toggleValue(current: string[], val: string): string[] {
  return current.includes(val) ? current.filter((x) => x !== val) : [...current, val];
}
