export const LOCK_FILE_NAMES: string[] = [
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'composer.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'poetry.lock',
];

export const BOILERPLATE_EXTENSIONS: string[] = [
  '.lock',
  '.snap',
  '.min.js',
  '.min.css',
  '.map',
];

export const ROLE_PATTERNS: {
  role: 'core' | 'wiring' | 'boilerplate';
  patterns: RegExp[];
}[] = [
  {
    role: 'boilerplate',
    patterns: [
      /(^|\/)dist\//,
      /(^|\/)generated\//,
      /(^|\/)node_modules\//,
      /\.generated\./,
      /__generated__/,
    ],
  },
  {
    role: 'core',
    patterns: [
      // directory-based (classic layered architecture)
      /\/services?\//,
      /\/repositor(?:y|ies)\//,   // matches /repository/ AND /repositories/
      /\/domain\//,
      /\/middleware\//,
      /\/models?\//,
      /\/entities?\//,
      /\/use-?cases?\//,
      // file-based (module-per-feature / NestJS / Fastify module style)
      /(^|\/)service\.[jt]sx?$/,
      /(^|\/)repositor(?:y|ies)\.[jt]sx?$/,
      /\.(service|repository|repo|usecase|use-case)\.[jt]sx?$/,
    ],
  },
];

// Priority order: boilerplate (lock/dist/snap) → core (service/repo/domain) → wiring (everything else)
export function classifyFile(path: string): 'core' | 'wiring' | 'boilerplate' {
  const basename = path.split('/').pop() ?? path;

  if (LOCK_FILE_NAMES.includes(basename)) return 'boilerplate';
  if (BOILERPLATE_EXTENSIONS.some(ext => path.endsWith(ext))) return 'boilerplate';

  for (const { role, patterns } of ROLE_PATTERNS) {
    if (patterns.some(re => re.test(path))) return role;
  }

  return 'wiring';
}
