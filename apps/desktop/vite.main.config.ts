import { builtinModules } from "node:module";

import { defineConfig } from "vite";

const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

export default defineConfig({
  build: {
    ssr: "src/main/index.ts",
    target: "node26",
    outDir: "dist/main",
    // Keep the last complete entry point available while the watch build starts.
    emptyOutDir: !process.argv.includes("--watch"),
    minify: false,
    sourcemap: false,
    rollupOptions: {
      external: (id) => id === "electron" || nodeBuiltins.has(id),
      output: {
        entryFileNames: "index.js",
        format: "es",
      },
    },
  },
  ssr: {
    noExternal: true,
  },
});
