import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
  // This is a static landing page: unknown URLs must not render the app shell.
  appType: "mpa",
  plugins: [
    react(),
    {
      name: "bundled-font-notices",
      generateBundle() {
        for (const family of ["Fredoka", "Figtree", "JetBrainsMono", "NotoSansMono"]) {
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
