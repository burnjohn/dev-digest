/**
 * RunnerError — thrown for any pre-flight / configuration failure (missing or
 * invalid manifest, missing skill file, missing required env var, malformed CI
 * context). Distinguished from a plain `Error` only for clearer log messages;
 * both are handled identically by `runCi`'s single top-level catch (see
 * `run.ts`): hard-fail, no PR post, no artifact, non-zero exit (Q5).
 */
export class RunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunnerError';
  }
}
