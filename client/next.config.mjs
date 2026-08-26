import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:3001",
  },
  /* The vendored `@devdigest/shared` copy uses NodeNext `./contracts/*.js`
     specifiers (canonical copy lives in `server/`, synced byte-identical by
     `scripts/sync-vendor.sh` — do NOT strip the extensions there). Next's
     webpack only maps `.js` → `.ts` when this is set; without it any runtime
     VALUE import of the barrel fails to resolve, while `tsc` and vitest both
     resolve it fine. Real `.js` stays last in each list so node_modules
     resolution is unaffected. */
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    },
  },
};

export default withNextIntl(nextConfig);
