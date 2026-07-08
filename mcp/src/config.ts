/**
 * Composition root for environment configuration.
 * This is the ONLY permitted process.env read in the entire mcp/ package.
 * DEVDIGEST_API_URL is not a secret — it is a plain service endpoint.
 */

export const config = {
  apiUrl: process.env['DEVDIGEST_API_URL'] ?? 'http://localhost:3001',
  logPretty: Boolean(process.env['LOG_PRETTY']),
} as const;

export type Config = typeof config;
