import type { FastifyPluginAsync } from 'fastify';
import settings from './settings/routes.js';
import repos from './repos/routes.js';
import pulls from './pulls/routes.js';
import polling from './polling/routes.js';
import workspace from './workspace/routes.js';
import agents from './agents/routes.js';
import skills from './skills/routes.js';
import conventions from './conventions/routes.js';
import reviews from './reviews/routes.js';
import repoIntel from './repo-intel/routes.js';

/**
 * Module registry. Each feature module is a Fastify plugin in
 * `modules/<name>/routes.ts`. Registered here in one place.
 *
 * ADD A MODULE: create `modules/<name>/routes.ts` exporting a default Fastify
 * plugin, then add one import + one entry below. (We register statically rather
 * than via filesystem autoload so the same code path works under tsx, the
 * bundler, and vitest — native dynamic import() of .ts files is not portable.)
 *
 * This is the Part-0 starter set. Each course lesson adds its own module here
 * (skills, intent/smart-diff, blast, brief/context/onboarding, eval/ci/hooks,
 * memory, plugins, …) without touching any other module or the shared schema.
 */
export const modules: Record<string, FastifyPluginAsync> = {
  settings,
  repos,
  pulls,
  polling,
  workspace,
  agents,
  skills,
  conventions,
  reviews,
  repoIntel,
};
