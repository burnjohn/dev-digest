import type { Skill, SkillSummary, SkillVersion } from "@devdigest/shared";
import { THIRD_PARTY_SOURCES } from "./constants";

/** Case-insensitive filter over name, description and type. */
export function filterSkills(skills: SkillSummary[], query: string): SkillSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.type.includes(q),
  );
}

/**
 * True when the skill's text was written by someone else. Its body becomes
 * instructions inside an agent's prompt exactly like a hand-written skill's —
 * the badge is the whole warning, so this drives it.
 */
export function isThirdParty(skill: Pick<Skill, "source">): boolean {
  return (THIRD_PARTY_SOURCES as readonly string[]).includes(skill.source);
}

/**
 * Rough token count for the body-size hint. The server counts with tiktoken;
 * the client has no tokenizer, so this is the same `chars / 4` heuristic the
 * server itself falls back to — always rendered with a `~` for that reason.
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Read a File as base64 for `POST /skills/import`. Split off the data-URL
 * prefix; the server decodes and parses, and never writes the bytes anywhere.
 */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}

// ---- version history -----------------------------------------------------

export interface DiffLine {
  kind: "add" | "remove" | "same";
  text: string;
}

/**
 * Line diff between two skill bodies.
 *
 * A skill body is a short markdown document, so this walks a plain LCS table
 * rather than pulling in a diff library — exact, and cheap at this size. Used
 * by the Versions tab to show what one save actually changed.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // lcs[i][j] = length of the longest common subsequence of a[i…] and b[j…].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ kind: "remove", text: a[i]! });
      i++;
    } else {
      out.push({ kind: "add", text: b[j]! });
      j++;
    }
  }
  while (i < a.length) out.push({ kind: "remove", text: a[i++]! });
  while (j < b.length) out.push({ kind: "add", text: b[j++]! });
  return out;
}

/** Added / removed line counts between two bodies. */
export function diffStat(before: string, after: string): { added: number; removed: number } {
  const lines = diffLines(before, after);
  return {
    added: lines.filter((l) => l.kind === "add").length,
    removed: lines.filter((l) => l.kind === "remove").length,
  };
}

export interface VersionDelta {
  version: SkillVersion;
  /** The next-older snapshot, or undefined for the very first one. */
  previous?: SkillVersion;
  added: number;
  removed: number;
  isFirst: boolean;
}

/**
 * Summarise each version against the one before it, newest first.
 *
 * `previous` comes from the neighbouring ROW rather than `version - 1`
 * arithmetic: version numbers are contiguous today, but pairing by position
 * keeps the diff correct if a snapshot is ever missing.
 */
export function versionDeltas(versions: SkillVersion[]): VersionDelta[] {
  const ordered = [...versions].sort((x, y) => y.version - x.version);
  return ordered.map((version, idx) => {
    const previous = ordered[idx + 1];
    if (!previous) {
      return { version, added: version.body.split("\n").length, removed: 0, isFirst: true };
    }
    return { version, previous, ...diffStat(previous.body, version.body), isFirst: false };
  });
}
