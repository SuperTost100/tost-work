import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { buildInfo } from "./build-info";
import { creditsPlugin } from "./credits";

export default defineConfig({
  plugins: [react(), creditsPlugin()],
  define: buildInfo,
  resolve: { alias: { "@": resolve(import.meta.dirname, "src/renderer/src") } },
  test: { environment: "jsdom", include: ["src/**/*.test.{ts,tsx}"], setupFiles: ["src/test-setup.ts"] },
});
