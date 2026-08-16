/**
 * Pure skill-import parsing. Takes an `ArrayBuffer`, returns plain data.
 *
 * Deliberately free of React, DOM and `File`: jsdom has no full `File`/
 * `FileReader` and no `DecompressionStream`, so anything that touched them would
 * be untestable. Everything here runs under `@vitest-environment node`.
 *
 * NOTHING from an archive is executed, and nothing is written to disk — entries
 * are only decoded into memory. That is what makes "executable parts are ignored"
 * a structural fact rather than a promise.
 */
import { unzipSync } from "fflate";

/** Reject absurd archives before spending time unzipping them. */
export const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 500;

export interface ParsedSkillFile {
  /** Name from front-matter or the first `# H1`; undefined if neither exists. */
  name?: string;
  /** Description from front-matter or the first prose paragraph. */
  description?: string;
  /** The markdown body that becomes the skill. */
  body: string;
  /** Archive entry actually used (undefined for a bare `.md` upload). */
  usedEntry?: string;
  /** Archive entries deliberately not imported (scripts, hooks, binaries, …). */
  skipped: string[];
}

export class SkillParseError extends Error {
  constructor(
    public readonly code:
      | "empty"
      | "too_large"
      | "too_many_entries"
      | "no_markdown",
    message: string,
  ) {
    super(message);
    this.name = "SkillParseError";
  }
}

const decoder = new TextDecoder("utf-8");

/** A zip's local-file-header magic — `PK\x03\x04`. */
function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * Parse an uploaded file into the fields a skill needs.
 *
 * Sniffs the zip magic rather than trusting the filename: a `.md` that is really
 * an archive (or vice versa) should still do the right thing, and the extension
 * is attacker-controlled in the sense that it is just a string the user typed.
 */
export function parseSkillUpload(buf: ArrayBuffer, fileName: string): ParsedSkillFile {
  const bytes = new Uint8Array(buf);
  if (bytes.byteLength === 0) throw new SkillParseError("empty", "File is empty");
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new SkillParseError("too_large", "File exceeds the size limit");
  }

  if (looksLikeZip(bytes)) return parseZip(bytes, fileName);

  const text = decoder.decode(bytes);
  if (!text.trim()) throw new SkillParseError("empty", "File is empty");
  return { ...parseSkillMarkdown(text), skipped: [] };
}

function parseZip(bytes: Uint8Array, archiveName: string): ParsedSkillFile {
  const entries = unzipSync(bytes);
  const names = Object.keys(entries);
  if (names.length > MAX_ARCHIVE_ENTRIES) {
    throw new SkillParseError("too_many_entries", "Archive has too many entries");
  }

  const chosen = chooseMarkdownEntry(names);
  if (!chosen) throw new SkillParseError("no_markdown", "No SKILL.md or .md file in the archive");

  const raw = entries[chosen];
  if (!raw || raw.byteLength === 0) throw new SkillParseError("empty", "Chosen markdown file is empty");

  const text = decoder.decode(raw);
  const { used, skipped } = classifyEntries(names, chosen);
  return {
    ...parseSkillMarkdown(text),
    usedEntry: used,
    // Record the archive itself too, so `evidence_files` says where this came from.
    skipped: [`archive: ${archiveName}`, ...skipped],
  };
}

/**
 * Pick the markdown entry to import: `SKILL.md` (case-insensitive, at any depth
 * but preferring the shallowest) — this is the Claude-skill convention — and
 * otherwise the shallowest `.md` file. Directory entries are ignored.
 */
export function chooseMarkdownEntry(names: string[]): string | undefined {
  const files = names.filter((n) => !n.endsWith("/"));
  const depth = (n: string) => n.split("/").length;
  const mds = files.filter((n) => /\.(md|markdown)$/i.test(n));

  const skillMds = mds
    .filter((n) => /(^|\/)skill\.md$/i.test(n))
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  if (skillMds[0]) return skillMds[0];

  return mds.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0];
}

/**
 * Split archive entries into the one that was imported and everything ignored.
 * Directory entries are dropped rather than listed — "skipped `rules/`" reads
 * like a failure when it is just a folder.
 */
export function classifyEntries(
  names: string[],
  chosen: string,
): { used: string; skipped: string[] } {
  const skipped = names.filter((n) => n !== chosen && !n.endsWith("/")).sort();
  return { used: chosen, skipped };
}

/**
 * Pull `name` / `description` out of a markdown document.
 *
 * Prefers YAML front-matter, because that is exactly the shape of a real Claude
 * skill (`---\nname: …\ndescription: …\n---`) and the demo imports one. Falls
 * back to the first `# H1` and the first prose paragraph.
 *
 * The front-matter block is STRIPPED from the body: it is metadata for the
 * loader, and leaving it in would put `name:`/`description:` lines into the
 * review prompt as if they were instructions.
 */
export function parseSkillMarkdown(text: string): {
  name?: string;
  description?: string;
  body: string;
} {
  const normalized = text.replace(/\r\n/g, "\n").replace(/^﻿/, "");
  const fm = extractFrontMatter(normalized);
  const body = (fm ? fm.rest : normalized).trim();

  const name = fm?.fields.name?.trim() || deriveH1(body);
  const description = fm?.fields.description?.trim() || deriveFirstParagraph(body);

  const out: { name?: string; description?: string; body: string } = { body };
  if (name) out.name = name;
  if (description) out.description = description;
  return out;
}

function extractFrontMatter(
  text: string,
): { fields: Record<string, string>; rest: string } | undefined {
  if (!text.startsWith("---\n")) return undefined;
  const end = text.indexOf("\n---", 3);
  if (end === -1) return undefined;

  const block = text.slice(4, end);
  const rest = text.slice(end + 4).replace(/^\n/, "");

  // A deliberately tiny `key: value` reader, not a YAML parser: skill
  // front-matter is flat, and pulling in js-yaml to read two strings would add a
  // parser (and its CVE surface) for no gain. Nested YAML is simply ignored.
  const fields: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m || !m[1]) continue;
    let value = (m[2] ?? "").trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    fields[m[1]] = value;
  }
  return { fields, rest };
}

function deriveH1(body: string): string | undefined {
  const m = body.match(/^[ \t]{0,3}#[ \t]+(.+?)[ \t]*#*[ \t]*$/m);
  return m?.[1]?.trim() || undefined;
}

/** First paragraph that is prose — not a heading, list item, fence, or quote. */
function deriveFirstParagraph(body: string): string | undefined {
  const withoutH1 = body.replace(/^[ \t]{0,3}#[ \t]+.*$/m, "");
  for (const block of withoutH1.split(/\n\s*\n/)) {
    const line = block.trim();
    if (!line) continue;
    if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|>|```|\||---)/.test(line)) continue;
    return line.replace(/\s+/g, " ").slice(0, 200);
  }
  return undefined;
}
