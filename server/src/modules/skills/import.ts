import { unzipSync, type UnzipFileInfo } from 'fflate';
import { MAX_SKILL_BODY_CHARS, SkillType, type SkillImportPreview } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import { DEFAULT_SKILL_TYPE, UNTITLED_SKILL_NAME } from './constants.js';

/**
 * Skill import — extract a skill's core from an uploaded `.md` or `.zip`.
 *
 * Pure: bytes in, preview out. Nothing here touches the DB, and the caller
 * persists only after the user confirms the preview.
 *
 * SECURITY POSTURE. An archive is a bag of arbitrary files from an untrusted
 * author, so the extractor's only move is to READ MARKDOWN. Every other entry is
 * listed by name and never decompressed — `unzipSync`'s per-entry `filter` runs
 * before inflation, so a script or binary in the archive is a string in the
 * `ignored` array and nothing else. There is no code path that writes an archive
 * entry to disk or executes one.
 *
 * The filter is also where DECOMPRESSION is bounded, and it has to be. Capping
 * the upload bounds only the COMPRESSED bytes: deflate reaches ~1000:1, so a 1MB
 * archive inflates to about a gigabyte, and `unzipSync` allocates that from the
 * entry's self-declared size before inflating a byte — synchronously, on the
 * event loop. Checking the extracted string's length afterwards is far too late.
 * So the filter rejects on `originalSize` and on a running budget, and the
 * inflated bytes are re-checked afterwards in case the header lied.
 *
 * The extracted BODY is still someone else's instructions: it reaches the model
 * unfenced (see specs/01-skills.md), which is why the service stores imported
 * skills disabled and a human has to enable them.
 */

/** Hard cap on an uploaded artefact. Skills are prose; megabytes mean abuse. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/**
 * Total bytes an archive is allowed to inflate to across every markdown entry
 * the filter accepts. One skill body's worth of slack over the single-entry cap,
 * so a legitimate pack with a README beside its SKILL.md still imports.
 */
export const MAX_ARCHIVE_INFLATED_BYTES = MAX_SKILL_BODY_CHARS * 2;

const MARKDOWN_RE = /\.(md|markdown)$/i;

/** Zip entries a well-formed archive carries that are noise, not "ignored content". */
const ARCHIVE_NOISE_RE = /(^|\/)(__MACOSX\/|\.DS_Store$)/;

export interface ImportArtifact {
  /** Original filename — decides the format and seeds the fallback name. */
  filename: string;
  bytes: Uint8Array;
}

/**
 * Parse YAML-ish frontmatter from the top of a SKILL.md.
 *
 * Deliberately NOT a YAML parser: the frontmatter this needs to read is the
 * flat `name:` / `description:` / `type:` block that the SKILL.md convention
 * uses (see any `SKILL.md` under `.claude/skills/`), and pulling in a YAML
 * dependency to read three scalars would be the larger risk. Anything nested is
 * ignored rather than guessed at.
 */
export function parseFrontmatter(body: string): {
  fields: Record<string, string>;
  rest: string;
} {
  if (!body.startsWith('---')) return { fields: {}, rest: body };
  const end = body.indexOf('\n---', 3);
  if (end === -1) return { fields: {}, rest: body };

  const block = body.slice(body.indexOf('\n') + 1, end);
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (!key || rawValue === undefined) continue;
    // Strip one layer of matching quotes — descriptions are routinely quoted
    // because they contain colons.
    const value = rawValue.trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
    if (value) fields[key.toLowerCase()] = value;
  }

  const afterDelimiter = body.indexOf('\n', end + 1);
  return { fields, rest: afterDelimiter === -1 ? '' : body.slice(afterDelimiter + 1) };
}

/** First markdown ATX heading text, e.g. `# Security Best Practices`. */
export function firstHeading(body: string): string | undefined {
  const match = /^#{1,6}\s+(.+?)\s*$/m.exec(body);
  return match?.[1];
}

/** `security/SKILL.md` → `security`; `pr-quality-rubric.md` → `pr-quality-rubric`. */
function nameFromPath(path: string): string | undefined {
  const base = path.split('/').pop() ?? path;
  const stem = base.replace(MARKDOWN_RE, '');
  // A bare SKILL.md carries no information — its directory does.
  if (/^skill$/i.test(stem)) {
    const parent = path.split('/').at(-2);
    return parent || undefined;
  }
  return stem || undefined;
}

/**
 * Choose which markdown entry in an archive IS the skill.
 *
 * Preference order: a `SKILL.md` (the convention's entry point), shallowest
 * first so a top-level skill wins over one nested in an examples folder; then
 * any other markdown, again shallowest, then alphabetical. Exported for tests —
 * the ranking is the part of import worth pinning down.
 */
export function pickSkillEntry(paths: string[]): string | undefined {
  const markdown = paths.filter((p) => MARKDOWN_RE.test(p) && !ARCHIVE_NOISE_RE.test(p));
  if (markdown.length === 0) return undefined;

  const depth = (p: string) => p.split('/').length;
  const isEntryPoint = (p: string) => /(^|\/)skill\.(md|markdown)$/i.test(p);

  return markdown.sort((a, b) => {
    if (isEntryPoint(a) !== isEntryPoint(b)) return isEntryPoint(a) ? -1 : 1;
    if (depth(a) !== depth(b)) return depth(a) - depth(b);
    return a.localeCompare(b);
  })[0];
}

interface ExtractedSource {
  path: string;
  text: string;
  ignored: string[];
}

function decodeUtf8(bytes: Uint8Array, what: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ValidationError(`${what} is not valid UTF-8 text`);
  }
}

function fromArchive(artifact: ImportArtifact): ExtractedSource {
  // Every entry name passes through the filter; only markdown is inflated, and
  // only if it fits.
  const seen: string[] = [];
  let budget = MAX_ARCHIVE_INFLATED_BYTES;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(artifact.bytes, {
      filter: (file: UnzipFileInfo) => {
        if (!file.name.endsWith('/')) seen.push(file.name);
        if (!MARKDOWN_RE.test(file.name) || ARCHIVE_NOISE_RE.test(file.name)) return false;
        // `originalSize` is the entry's declared uncompressed length, and fflate
        // allocates from it — so this is the last point at which a bomb can be
        // refused for free.
        if (file.originalSize > MAX_SKILL_BODY_CHARS) {
          throw new ValidationError(
            `${file.name} is larger than the ${MAX_SKILL_BODY_CHARS.toLocaleString('en-US')}-character skill body limit`,
          );
        }
        budget -= file.originalSize;
        if (budget < 0) {
          throw new ValidationError('The archive expands past the import limit');
        }
        return true;
      },
    });
  } catch (err) {
    // A limit rejection thrown from the filter surfaces here; passing it through
    // keeps the real reason instead of reporting "is it a valid .zip?".
    if (err instanceof ValidationError) throw err;
    throw new ValidationError('Could not read the archive — is it a valid .zip?');
  }

  const chosen = pickSkillEntry(Object.keys(entries));
  if (!chosen) {
    throw new ValidationError('No markdown file in the archive — nothing to import as a skill');
  }

  const bytes = entries[chosen];
  if (!bytes) throw new ValidationError('No markdown file in the archive — nothing to import');
  // The header is the author's claim, not a fact. Re-check the real length.
  if (bytes.length > MAX_SKILL_BODY_CHARS) {
    throw new ValidationError(
      `${chosen} is larger than the ${MAX_SKILL_BODY_CHARS.toLocaleString('en-US')}-character skill body limit`,
    );
  }

  return {
    path: chosen,
    text: decodeUtf8(bytes, chosen),
    ignored: seen.filter((n) => n !== chosen && !ARCHIVE_NOISE_RE.test(n)).sort(),
  };
}

/**
 * Extract a skill preview from an uploaded artefact. Throws `ValidationError`
 * (→ 422) for anything unreadable; the route never has to interpret bytes.
 */
export function extractSkill(artifact: ImportArtifact): SkillImportPreview {
  if (artifact.bytes.length === 0) throw new ValidationError('The uploaded file is empty');
  if (artifact.bytes.length > MAX_IMPORT_BYTES) {
    throw new ValidationError(
      `File is larger than the ${Math.round(MAX_IMPORT_BYTES / 1024)}KB import limit`,
    );
  }

  const isZip = /\.zip$/i.test(artifact.filename);
  const source: ExtractedSource = isZip
    ? fromArchive(artifact)
    : MARKDOWN_RE.test(artifact.filename)
      ? { path: artifact.filename, text: decodeUtf8(artifact.bytes, artifact.filename), ignored: [] }
      : (() => {
          throw new ValidationError('Import a .md, .markdown or .zip file');
        })();

  if (source.text.length > MAX_SKILL_BODY_CHARS) {
    throw new ValidationError(
      `Skill body is longer than the ${MAX_SKILL_BODY_CHARS.toLocaleString('en-US')}-character limit`,
    );
  }

  const { fields, rest } = parseFrontmatter(source.text);
  const body = rest.trim();
  if (!body) throw new ValidationError('The skill body is empty');

  // Frontmatter wins over the heading: a SKILL.md that declares its own name and
  // description is stating its interface, and that is what the agent's prompt
  // should carry.
  const name =
    fields.name ?? firstHeading(body) ?? nameFromPath(source.path) ?? UNTITLED_SKILL_NAME;
  const parsedType = SkillType.safeParse(fields.type);

  return {
    name,
    description: fields.description ?? '',
    type: parsedType.success ? parsedType.data : DEFAULT_SKILL_TYPE,
    // The extractor owns provenance. Anything that arrived as a file is foreign,
    // so the create it feeds is disabled on arrival without the client having to
    // remember to say so.
    source: 'community',
    body,
    source_path: source.path,
    ignored: source.ignored,
    size_bytes: artifact.bytes.length,
  };
}
