import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import type { Plugin } from "vite";
import { buildInfo } from "./build-info";
import { creditsPlugin } from "./credits";
import { licensesPlugin } from "./licenses";

// The production page may load nothing from the network. The dev server injects an inline React preamble, which this
// policy would block, so it is added only to the built page.
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'";
const cspInBuild = (): Plugin => ({
  name: "tost-work-csp",
  apply: "build",
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
  ],
});

export default defineConfig({
  main: { define: buildInfo, plugins: [licensesPlugin({ write: false })] },
  preload: {
    define: buildInfo,
    plugins: [licensesPlugin({ write: false })],
    // Sandboxed preloads must be CommonJS.
    build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } },
  },
  renderer: {
    define: buildInfo,
    resolve: { alias: { "@": resolve("src/renderer/src") } },
    plugins: [react(), creditsPlugin(), licensesPlugin({ write: true }), cspInBuild()],
  },
});
