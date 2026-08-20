import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Env-driven build dir so an isolated stack (scripts/e2e.sh exports
  // NEXT_DIST_DIR=.next-e2e) never compiles its own NEXT_PUBLIC_API_BASE into
  // the shared .next and silently poisons a concurrently running dev server.
  // Default behavior unchanged: unset → .next.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },
  // src/vendor/shared uses ESM-style `.js` specifiers between its TypeScript
  // files (they mirror the server copy byte-for-byte). tsc/vitest/tsx resolve
  // `.js` → `.ts` natively; webpack needs extensionAlias or the first RUNTIME
  // import from @devdigest/shared fails with "Can't resolve './contracts/x.js'"
  // (type-only imports are erased, which is why this never surfaced before).
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default withNextIntl(nextConfig);
