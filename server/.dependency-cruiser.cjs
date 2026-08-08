const { readdirSync } = require('node:fs');
const path = require('node:path');

const source = String.raw`(?:^|/)src`;
const modules = `${source}/modules`;
const reviewerCore = String.raw`(?:^|/)reviewer-core/src`;
const nodeModules = String.raw`(?:^|/)node_modules`;
const externalModules = `${nodeModules}/(?:@fastify/[^/]+|fastify(?:-sse-v2|-type-provider-zod)?|drizzle-orm|postgres|octokit|openai|@anthropic-ai/sdk|simple-git|@ast-grep/napi|@vscode/ripgrep|p-queue|dotenv)(?:/|$)`;
const databaseModules = `${nodeModules}/(?:drizzle-orm|postgres)(?:/|$)`;
const infrastructureCore = String.raw`^(?:node:)?(?:child_process|crypto|fs(?:/promises)?|http|https|net|os|path|stream|worker_threads)(?:/|$)`;
const boundaryModules = [
  externalModules,
  infrastructureCore,
  `${nodeModules}/zod(?:/|$)`,
  String.raw`^src/vendor/shared/`,
];
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const featureNames = readdirSync(path.join(__dirname, 'src', 'modules'), {
  withFileTypes: true,
})
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
  .map((entry) => escapeRegex(entry.name));
const adapterKinds = ['http', 'persistence', 'external', 'jobs'];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular-backend-dependencies',
      severity: 'error',
      from: { path: [`${source}/`, `${reviewerCore}/`] },
      to: { circular: true },
    },
    {
      name: 'domain-depends-only-inward',
      severity: 'error',
      from: { path: `${modules}/[^/]+/domain/` },
      to: {
        path: [
          `${modules}/[^/]+/(?:application|adapters)/`,
          `${source}/(?:adapters|db|platform)/`,
          ...boundaryModules,
        ],
      },
    },
    {
      name: 'application-depends-only-inward',
      severity: 'error',
      from: { path: `${modules}/[^/]+/application/` },
      to: {
        path: [
          `${modules}/[^/]+/adapters/`,
          `${source}/(?:adapters|db|platform)/`,
          ...boundaryModules,
        ],
      },
    },
    {
      name: 'legacy-routes-do-not-query-persistence',
      severity: 'error',
      from: { path: `${modules}/[^/]+/routes[.]ts$` },
      to: { path: [`${source}/db/`, databaseModules] },
    },
    {
      name: 'legacy-services-do-not-construct-infrastructure',
      severity: 'error',
      from: { path: `${modules}/[^/]+/service[.]ts$` },
      to: {
        path: [
          `${modules}/[^/]+/repository(?:/|[.]ts$)`,
          `${source}/adapters/`,
          `${source}/db/`,
          `${source}/platform/container[.]ts$`,
          externalModules,
        ],
      },
    },
    {
      name: 'feature-public-api-does-not-export-adapters',
      severity: 'error',
      from: { path: `${modules}/[^/]+/index[.]ts$` },
      to: { path: `${modules}/[^/]+/adapters/` },
    },
    {
      name: 'reviewer-core-does-not-depend-on-server-or-vendors',
      severity: 'error',
      from: { path: `${reviewerCore}/` },
      to: { path: [String.raw`^src/`, externalModules, infrastructureCore] },
    },
    ...adapterKinds.map((kind) => ({
      name: `no-${kind}-adapter-to-other-adapter-kinds`,
      severity: 'error',
      from: { path: `${modules}/[^/]+/adapters/${kind}/` },
      to: { path: `${modules}/[^/]+/adapters/(?!${kind}/)` },
    })),
    ...featureNames.map((feature) => ({
      name: `no-cross-feature-imports-into-${feature}-adapters`,
      severity: 'error',
      from: { path: `${modules}/(?!${feature}/)[^/]+/` },
      to: { path: `${modules}/${feature}/adapters/` },
    })),
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    preserveSymlinks: true,
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: 'specify',
    exclude: { path: '(?:^|/)(?:dist|coverage)/' },
  },
};
