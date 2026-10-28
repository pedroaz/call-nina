import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  // This is a static landing page: unknown URLs must not render the app shell.
  appType: "mpa",
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // Do not transform a temporarily empty module while an editor is writing it.
    watch: { awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 } },
  },
  plugins: [
    react(),
    {
      name: "bundled-font-notices",
      generateBundle() {
        for (const family of [
          "Fredoka",
          "Figtree",
          "JetBrainsMono",
          "NotoSansMono",
          "SourceSans3",
          "SourceSerif4",
        ]) {
          this.emitFile({
            type: "asset",
            fileName: `notices/fonts/OFL-${family}.txt`,
            source: readFileSync(
              new URL(
                `../../packages/design-system/assets/fonts/OFL-${family}.txt`,
                import.meta.url,
              ),
            ),
          });
        }
      },
    },
  ],
});
