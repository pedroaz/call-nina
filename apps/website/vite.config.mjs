import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { hostingEnvironment } from "../../scripts/lib/hosting-environment.mjs";
import infrastructure from "../../scripts/admin/infrastructure.json" with { type: "json" };
import { GET as downloads } from "../api/api/downloads.ts";
const environment = hostingEnvironment(process.env.NINA_ENVIRONMENT ?? "dev");
const origin = infrastructure[environment].origin;
const indexable = environment === "prd";
const robots = indexable
  ? `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`
  : "User-agent: *\nDisallow: /\n";
const pages = ["/", "/about/", "/privacy/"];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${indexable ? pages.map((page) => `<url><loc>${origin}${page}</loc></url>`).join("") : ""}</urlset>\n`;
export default defineConfig({
  define: { __NINA_WEBSITE_ORIGIN__: JSON.stringify(origin) },
  // This is a static landing page: unknown URLs must not render the app shell.
  appType: "mpa",
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        about: fileURLToPath(new URL("./about/index.html", import.meta.url)),
        privacy: fileURLToPath(new URL("./privacy/index.html", import.meta.url)),
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
      name: "website-search",
      transformIndexHtml: {
        order: "post",
        handler(html, context) {
          const page = context.path.startsWith("/about")
            ? "/about/"
            : context.path.startsWith("/privacy")
              ? "/privacy/"
              : "/";
          return {
            html,
            tags: [
              {
                tag: "link",
                attrs: { rel: "canonical", href: `${origin}${page}` },
                injectTo: "head",
              },
              { tag: "meta", attrs: { name: "referrer", content: "origin" }, injectTo: "head" },
              ...(!indexable
                ? [{ tag: "meta", attrs: { name: "robots", content: "noindex" }, injectTo: "head" }]
                : []),
            ],
          };
        },
      },
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "robots.txt", source: robots });
        this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemap });
      },
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          response.setHeader("X-Robots-Tag", "noindex");
          const pathname = request.url?.split("?")[0];
          if (pathname === "/robots.txt" || pathname === "/sitemap.xml") {
            response.setHeader(
              "Content-Type",
              pathname === "/robots.txt"
                ? "text/plain; charset=utf-8"
                : "application/xml; charset=utf-8",
            );
            response.end(pathname === "/robots.txt" ? "User-agent: *\nDisallow: /\n" : sitemap);
            return;
          }
          next();
        });
      },
    },
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
