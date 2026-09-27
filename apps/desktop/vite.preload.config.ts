import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: "src/preload/index.ts",
      formats: ["cjs"],
      fileName: () => "index.cjs",
    },
    outDir: "dist/preload",
    emptyOutDir: false,
    rollupOptions: {
      external: ["electron"],
    },
  },
});
