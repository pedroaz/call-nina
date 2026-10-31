import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { GET as downloads } from "../api/api/downloads.ts";
export default defineConfig({
  // This is a static landing page: unknown URLs must not render the app shell.
  appType: "mpa",
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        about: fileURLToPath(new URL("./about/index.html", import.meta.url)),
      },
    },
  },
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
      name: "downloads-api",
      configureServer(server) {
        server.middlewares.use(async (request, response, next) => {
          if (request.url?.split("?")[0] !== "/api/downloads") return next();
          if (request.method !== "GET") {
            response.writeHead(405, { Allow: "GET" }).end();
            return;
          }
          const result = await downloads();
          response.writeHead(result.status, Object.fromEntries(result.headers));
          response.end(await result.text());
        });
      },
    },
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
