/** Constants for the skills module. */

/** Initial version recorded for a newly-created skill. */
export const INITIAL_SKILL_VERSION = 1;

/** Type assigned to an imported skill whose frontmatter declares none. */
export const DEFAULT_SKILL_TYPE = 'custom' as const;

/** Description used when an imported file carries neither frontmatter nor prose. */
export const DEFAULT_SKILL_DESCRIPTION = 'Imported skill — add a description.';

// ---- Import limits -------------------------------------------------------
// A skill is text. These caps exist so a hostile archive cannot turn an import
// into a memory-exhaustion bug: we never write to disk or execute anything, but
// we do decompress in memory, so decompression itself has to be bounded.

/** Max decoded upload size (before unzip). */
export const MAX_UPLOAD_BYTES = 512 * 1024;

/** Max members read from an archive. */
export const MAX_ARCHIVE_ENTRIES = 200;

/** Max total uncompressed bytes read from an archive. */
export const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024;

/** Max size of the markdown body taken from the upload. */
export const MAX_BODY_BYTES = 256 * 1024;

/** Filenames preferred as the skill core, in order, before falling back. */
export const SKILL_CORE_NAMES = ['skill.md', 'readme.md'];

/** Extensions that make an ignored archive member worth warning about. */
export const EXECUTABLE_EXTENSIONS = [
  '.sh',
  '.bash',
  '.zsh',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.py',
  '.rb',
  '.pl',
  '.php',
  '.bat',
  '.cmd',
  '.ps1',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
];

/** Description length taken from the first paragraph when none is declared. */
export const DERIVED_DESCRIPTION_MAX_CHARS = 200;

/** Max length of the optional "what changed" note stored with a version. */
export const MAX_VERSION_MESSAGE_CHARS = 200;
