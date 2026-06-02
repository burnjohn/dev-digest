/**
 * A3 — pure helpers for the Project Context indexer (extracted from service.ts;
 * no behaviour change). Side-effect free; operate purely on their arguments.
 */
import { ValidationError } from '../../platform/errors.js';
import { CHUNK_MAX_CHARS, SPEC_PATH_EXT, SPEC_PATH_PREFIX } from './constants.js';

/**
 * Validate that a spec path is a `.md` file under `.devdigest/specs/` with no
 * traversal. Throws ValidationError on a bad path.
 */
export function assertSafeSpecPath(specPath: string): void {
  const normalized = specPath.replace(/\\/g, '/');
  if (
    normalized.includes('..') ||
    normalized.startsWith('/') ||
    !normalized.startsWith(SPEC_PATH_PREFIX) ||
    !normalized.endsWith(SPEC_PATH_EXT)
  ) {
    throw new ValidationError(
      'Spec path must be a .md file under .devdigest/specs/ (no traversal)',
    );
  }
}

/** Heading-aware markdown chunker (keeps sections together; caps size). */
export function chunk(content: string, max = CHUNK_MAX_CHARS): string[] {
  // split on top-level headings first so chunks map to spec sections
  const sections = content.split(/\n(?=#{1,3}\s)/);
  const out: string[] = [];
  for (const section of sections) {
    if (section.length <= max) {
      if (section.trim()) out.push(section.trim());
      continue;
    }
    // oversize section → fall back to paragraph packing
    const paras = section.split(/\n{2,}/).filter((p) => p.trim());
    let buf = '';
    for (const p of paras) {
      if ((buf + '\n\n' + p).length > max && buf) {
        out.push(buf);
        buf = p;
      } else {
        buf = buf ? `${buf}\n\n${p}` : p;
      }
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out.length ? out : content.trim() ? [content.trim()] : [];
}
