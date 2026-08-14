import type { Skill } from "@devdigest/shared";

/** Case-insensitive filter over a skill's name, description and type. */
export function filterSkills(skills: Skill[], search: string): Skill[] {
  const q = search.trim().toLowerCase();
  if (!q) return skills;
  return skills.filter((s) => `${s.name} ${s.description} ${s.type}`.toLowerCase().includes(q));
}

/**
 * Character-based token estimate for the Config tab's live count.
 *
 * Same `ceil(chars / 4)` heuristic `reviewer-core/src/prompt.ts` uses for the
 * run trace's `section_sizes`, on purpose — this number exists to preview
 * roughly what that trace will report once the skill is saved and linked, and
 * a different formula here would make the two numbers disagree for no reason.
 * NOT a tokenizer result; never present it as a billed figure.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** A 0..1 ratio as a whole-percent integer for display, e.g. 0.735 → 74. */
export function toPercent(ratio: number): number {
  return Math.round(ratio * 100);
}

/**
 * Whether a skill's body is someone else's text.
 *
 * Drives the "untrusted source" badge and the vetting notice. `extracted`
 * skills come from the conventions scanner over the user's OWN repo, so they are
 * not foreign — only a fetch or a download is.
 */
export function isUntrusted(skill: Pick<Skill, "source">): boolean {
  return skill.source === "imported_url" || skill.source === "community";
}

/**
 * Thrown when the browser cannot read a picked file.
 *
 * A marker class rather than a message: the drawer renders whatever a caught
 * error carries, and a hardcoded English string there would bypass next-intl.
 * Server errors keep their own text — those are already localized upstream.
 */
export class FileReadError extends Error {
  constructor() {
    super("FILE_READ_FAILED");
    this.name = "FileReadError";
  }
}

/** Read a picked file as base64, the shape `POST /skills/import/preview` takes. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new FileReadError());
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new FileReadError());
        return;
      }
      // readAsDataURL gives `data:<mime>;base64,<payload>` — the API wants the
      // payload alone. Reading as a data URL rather than an ArrayBuffer avoids
      // hand-rolling a base64 encoder over a binary zip.
      const comma = result.indexOf(",");
      resolve(comma === -1 ? "" : result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}
