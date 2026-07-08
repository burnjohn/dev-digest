import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  // Prevent Vite from loading PostCSS (lightningcss native binding not
  // available in this dev environment — tests don't need CSS processing).
  css: { postcss: { plugins: [] } },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@devdigest/shared": path.resolve(__dirname, "src/vendor/shared"),
      "@devdigest/ui": path.resolve(__dirname, "src/vendor/ui"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
