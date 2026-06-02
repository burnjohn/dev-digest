import { buildApp } from './app.js';
import { loadConfig } from './platform/config.js';

/** Production/dev entrypoint. `pnpm dev` runs `tsx watch src/server.ts`. */
async function main() {
  const config = loadConfig();
  const app = await buildApp({ config });
  try {
    await app.listen({ port: config.apiPort, host: '0.0.0.0' });
    app.log.info(`DevDigest API listening on http://localhost:${config.apiPort}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
