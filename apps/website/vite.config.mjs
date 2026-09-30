import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import {
  articles,
  articleHref,
  blogDescription,
  blogTitle,
  validateArticles,
} from "./src/blog/articles.ts";

const escapeHtml = (text) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

export default defineConfig({
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
    {
      name: "static-blog-pages",
      enforce: "post",
      buildStart() {
        validateArticles(articles);
      },
      generateBundle(_options, bundle) {
        const shell = bundle["index.html"];
        if (!shell || shell.type !== "asset" || typeof shell.source !== "string")
          throw new Error("Missing website HTML shell");
        const pages = [
          { path: "/blog/", title: blogTitle, description: blogDescription },
          ...articles.map((article) => ({
            path: articleHref(article.slug),
            title: `${article.title} — Call Nina`,
            description: article.summary,
          })),
        ];
        for (const page of pages) {
          this.emitFile({
            type: "asset",
            fileName: `${page.path.slice(1)}index.html`,
            source: shell.source
              .replace(
                /<noscript\b[\s\S]*?<\/noscript\s*>/,
                () =>
                  `<noscript>${escapeHtml(page.title)} — ${escapeHtml(page.description)} Enable JavaScript to read the blog.</noscript>`,
              )
              .replace(/<title>.*?<\/title>/s, () => `<title>${escapeHtml(page.title)}</title>`)
              .replace(
                /(<meta\s+name="description"\s+content=")[^"]*("\s*\/>)/,
                (_match, start, end) => `${start}${escapeHtml(page.description)}${end}`,
              ),
          });
        }
      },
    },
  ],
});
