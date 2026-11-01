import { defineConfig } from "vite";

export default defineConfig({
  build: {
    ssr: "src/index.ts",
    target: "node24",
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    rollupOptions: {
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
