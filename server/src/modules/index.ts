import type { FastifyPluginAsync } from 'fastify';
import settings from './settings/routes.js';
import repos from './repos/routes.js';
import pulls from './pulls/routes.js';
import polling from './polling/routes.js';
import workspace from './workspace/routes.js';
import context from './context/routes.js';
import skills from './skills/routes.js';
import conventions from './conventions/routes.js';
import memory from './memory/routes.js';
import agents from './agents/routes.js';
import reviews from './reviews/routes.js';
// A3 — Context & Codebase
import blast from './blast/routes.js';
import brief from './brief/routes.js';
import onboarding from './onboarding/routes.js';
// A4 — Eval & CI
import evalModule from './eval/routes.js';
import compose from './compose/routes.js';
import ci from './ci/routes.js';
import conformance from './conformance/routes.js';
import hooks from './hooks/routes.js';
// A5 — Multi-agent & Observability
import runs from './runs/routes.js';
// A6 — Productionize & Cross-cutting
import plugins from './plugins/routes.js';
import performance from './performance/routes.js';
import digest from './digest/routes.js';

/**
 * Module registry. Each feature module is a Fastify plugin in
 * `modules/<name>/routes.ts`. Registered here in one place.
 *
 * ADD A MODULE: create `modules/<name>/routes.ts` exporting a default Fastify
 * plugin, then add one import + one entry below. (We register statically rather
 * than via filesystem autoload so the same code path works under tsx, the
 * bundler, and vitest — native dynamic import() of .ts files is not portable.)
 *
 * Feature agents A1–A6 add their own modules here without touching any other
 * module or the shared schema.
 */
export const modules: Record<string, FastifyPluginAsync> = {
  settings,
  repos,
  pulls,
  polling,
  workspace,
  context,
  skills,
  conventions,
  memory,
  agents,
  reviews,
  blast,
  brief,
  onboarding,
  eval: evalModule,
  compose,
  ci,
  conformance,
  hooks,
  runs,
  plugins,
  performance,
  digest,
};
