import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { FastifySSEPlugin } from 'fastify-sse-v2';
import { z } from 'zod';
import { loadConfig, type AppConfig } from './platform/config.js';
import { createDb, type Db } from './db/client.js';
import { Container, type ContainerOverrides } from './platform/container.js';
import { AppError } from './platform/errors.js';
import { modules } from './modules/index.js';

// Attach the DI container to every request/instance.
declare module 'fastify' {
  interface FastifyInstance {
    container: Container;
  }
}

export interface BuildAppOptions {
  config?: AppConfig;
  db?: Db;
  overrides?: ContainerOverrides;
}

/**
 * buildApp() — exported so tests can use `app.inject()` without a real port.
 * Registers cors, SSE, the DI container, autoloaded feature modules, and a
 * structured error handler returning the §12 ApiErrorBody envelope.
 */
export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadConfig();
  const handle = opts.db ? null : createDb(config.databaseUrl);
  const db = opts.db ?? handle!.db;

  const app = Fastify({
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            transport:
              config.nodeEnv === 'development'
                ? { target: 'pino-pretty', options: { colorize: true } }
                : undefined,
          },
  });

  const container = new Container(config, db, opts.overrides);
  app.decorate('container', container);

  await app.register(cors, { origin: [config.webOrigin], credentials: true });
  await app.register(FastifySSEPlugin);

  // Health check (no module).
  app.get('/health', async () => ({ status: 'ok' }));

  // Structured error handler (§12). Registered BEFORE modules so encapsulated
  // module plugins inherit it. Validation → 422; AppError → its status.
  app.setErrorHandler((err: unknown, _req, reply) => {
    // Robust ZodError detection: `instanceof` can fail across duplicate zod
    // module instances (shared vs api), so also match by shape.
    const maybeZod = err as { name?: string; issues?: unknown; errors?: unknown };
    const isZodError =
      err instanceof z.ZodError ||
      (maybeZod?.name === 'ZodError' &&
        (Array.isArray(maybeZod.issues) || Array.isArray(maybeZod.errors)));
    if (isZodError) {
      reply.status(422).send({
        error: {
          code: 'validation_error',
          message: 'Request validation failed',
          details: maybeZod.issues ?? maybeZod.errors,
        },
      });
      return;
    }
    if (err instanceof AppError) {
      reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message, details: err.details },
      });
      return;
    }
    app.log.error(err);
    const e = err as { statusCode?: number; message?: string };
    reply.status(e.statusCode ?? 500).send({
      error: { code: 'internal_error', message: e.message ?? 'Internal error' },
    });
  });

  // Register feature modules from the static registry (src/modules/index.ts).
  // Each module is a Fastify plugin in modules/<name>/routes.ts.
  for (const plugin of Object.values(modules)) {
    await app.register(plugin);
  }

  // Close the db handle we created on shutdown.
  if (handle) app.addHook('onClose', async () => handle.close());

  return app;
}
