export const SPLIT_THRESHOLD_LINES = 500;

/** Target max lines per proposed split chunk when a diff is too large. */
export const SPLIT_CHUNK_SIZE = 150;

// Checked first — highest priority
export const BOILERPLATE_PATTERNS = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'composer.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'poetry.lock',
] as const;

export const BOILERPLATE_SEGMENT_PATTERNS = [
  'dist/',
  'build/',
  '.next/',
  'out/',
  'generated/',
  '__generated__/',
  '__snapshots__/',
  'coverage/',
  '.turbo/',
  '.cache/',
] as const;

export const BOILERPLATE_SUFFIX_PATTERNS = [
  '.min.js',
  '.min.css',
  '.d.ts',
  '.snap',
  '.lock',
] as const;

// Checked second — middle priority
export const WIRING_FILENAMES = [
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'routes.ts',
  'routes.js',
  'router.ts',
  'router.js',
  'module.ts',
  'config.ts',
  'config.js',
  'setup.ts',
  'setup.js',
  'schema.ts',
  'schema.js',
] as const;

export const WIRING_SEGMENT_PATTERNS = [
  'migrations/',
  'seeds/',
  'fixtures/',
] as const;

export const WIRING_SUFFIX_PATTERNS = [
  '.sql',
  '.json',
  '.yaml',
  '.yml',
  '.toml',
  '.env',
] as const;

export const WIRING_PREFIX_PATTERNS = [
  '.env',
  'docker-compose',
  'Dockerfile',
  '.github/',
  '.husky/',
] as const;
