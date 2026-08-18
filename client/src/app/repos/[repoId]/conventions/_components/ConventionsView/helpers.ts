import type { ConventionCandidate } from "@devdigest/shared";

/** Short kebab-case heading derived from a rule's first few words. */
export function slugifyRule(rule: string): string {
  const slug = rule
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join("-");
  return slug || "rule";
}

/** Default skill name: "<repo>-conventions" — matches the design's "payments-api-conventions". */
export function defaultSkillName(repoFullName: string | null | undefined): string {
  const short = (repoFullName ?? "repo").split("/").pop() || "repo";
  return `${short}-conventions`;
}

/**
 * Merge accepted candidates into one markdown skill body — one `##` section per
 * candidate citing its verified `file:line` evidence and the real on-disk
 * snippet. Fully editable afterward; this is just the starting draft.
 */
export function buildSkillBody(name: string, candidates: ConventionCandidate[]): string {
  const sections = candidates.map((c) =>
    [
      `## ${slugifyRule(c.rule)}`,
      c.rule,
      "",
      `Detected in \`${c.evidence_path}:${c.evidence_start_line}-${c.evidence_end_line}\`:`,
      "",
      "```",
      c.evidence_snippet,
      "```",
    ].join("\n"),
  );
  return [
    `# ${name}`,
    "",
    "House conventions for this repo. Flag changes that violate any rule below and cite the offending `file:line`.",
    "",
    ...sections,
  ].join("\n");
}
