import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import desktopPackage from "./package.json" with { type: "json" };

import { defineConfig } from "vite";
import {
  clientConfigurationAlias,
  requireClientConfiguration,
  desktopEnvironmentPlugin,
} from "../../scripts/lib/hosting-environment.mjs";

requireClientConfiguration();

const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const speechCatalogFile = new URL("../../build/speech-distribution/catalog.json", import.meta.url);
let speechRuntimes: unknown = [];
try {
  speechRuntimes = JSON.parse(readFileSync(speechCatalogFile, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  if (process.env.GITHUB_ACTIONS === "true" && process.platform === "linux")
    throw new Error("OD_SPEECH_RELEASE_CATALOG_REQUIRED");
}
if (process.env.GITHUB_ACTIONS === "true" && process.platform === "linux") {
  const releaseRuntimes: unknown[] = Array.isArray(speechRuntimes) ? speechRuntimes : [];
  if (
    releaseRuntimes.length !== 2 ||
    !["piper", "pocket"].every((engine) =>
      releaseRuntimes.some(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          "engine" in entry &&
          entry.engine === engine &&
          "runtime" in entry &&
          typeof entry.runtime === "object" &&
          entry.runtime !== null &&
          "url" in entry.runtime &&
          typeof entry.runtime.url === "string" &&
          entry.runtime.url.startsWith(
            `https://github.com/pedroaz/call-nina/releases/download/desktop-v${desktopPackage.version}/`,
          ),
      ),
    )
  )
    throw new Error("OD_SPEECH_RELEASE_CATALOG_REQUIRED");
}

export default defineConfig({
  plugins: [desktopEnvironmentPlugin()],
  define: {
    __NINA_APP_VERSION__: JSON.stringify(desktopPackage.version),
    __NINA_BUILD_COMMIT__: JSON.stringify(
      /^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? "") ? process.env.GITHUB_SHA : "local",
    ),
    __NINA_BUILD_RUN__: JSON.stringify(
      /^\d+$/.test(process.env.GITHUB_RUN_ID ?? "") ? process.env.GITHUB_RUN_ID : "local",
    ),
    __NINA_SPEECH_RUNTIMES__: JSON.stringify(
      gzipSync(JSON.stringify(speechRuntimes)).toString("base64"),
    ),
  },
  resolve: { alias: [clientConfigurationAlias()] },
  build: {
    ssr: "src/main/index.ts",
    target: "node24",
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
