#!/usr/bin/env node

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { pnpmCommand } from "../lib/package-command.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const outputFile = path.join(repositoryRoot, "docs", "third-party-notices.md");
const execFileAsync = promisify(execFile);

function licenseOf(manifest) {
  if (typeof manifest.license === "string" && manifest.license.trim())
    return manifest.license.trim();
  if (Array.isArray(manifest.licenses)) {
    const values = manifest.licenses
      .map((entry) => (typeof entry === "string" ? entry : entry?.type))
      .filter((entry) => typeof entry === "string" && entry.trim());
    if (values.length > 0) return values.join(", ");
  }
  return "UNSPECIFIED (see package metadata)";
}

async function readInstalledPackages() {
  const { stdout } = await execFileAsync(
    ...pnpmCommand([
      "--filter",
      "@call-nina/desktop",
      "--filter",
      "@call-nina/mcp-server",
      "list",
      "--json",
      "--depth",
      "Infinity",
    ]),
    { cwd: repositoryRoot, maxBuffer: 64 * 1024 * 1024 },
  );
  const workspaces = JSON.parse(stdout);
  const packages = new Map();
  const visited = new Set();
  const buildOnlyPackages = new Set(["@types/node", "typescript"]);
  const runtimeRoots = new Set([
    "@modelcontextprotocol/server",
    "@call-nina/codex-client",
    "@call-nina/learning-workflows",
    "@call-nina/contracts",
    "@call-nina/domain",
    "@call-nina/persistence",
    "electron",
    "i18next",
    "lucide-react",
    "react",
    "react-aria-components",
    "react-dom",
    "react-i18next",
    "yaml",
    "zod",
  ]);
  async function visitDependencies(dependencies) {
    if (!dependencies || typeof dependencies !== "object") return;
    for (const dependency of Object.values(dependencies)) {
      if (!dependency || typeof dependency !== "object") continue;
      const dependencyPath = dependency.path;
      // pnpm may emit a deduplicated leaf before the expanded dependency tree.
      // Visit every tree occurrence, even when its package metadata was already read.
      await visitDependencies(dependency.dependencies);
      await visitDependencies(dependency.optionalDependencies);
      if (typeof dependencyPath !== "string" || visited.has(dependencyPath)) continue;
      visited.add(dependencyPath);
      try {
        const manifest = JSON.parse(await readFile(path.join(dependencyPath, "package.json")));
        if (
          typeof manifest.name === "string" &&
          manifest.name !== "call-nina" &&
          !manifest.name.startsWith("@call-nina/") &&
          !buildOnlyPackages.has(manifest.name)
        ) {
          const key = `${manifest.name}@${manifest.version ?? "unknown"}`;
          packages.set(key, {
            name: manifest.name,
            version: manifest.version ?? "unknown",
            license: licenseOf(manifest),
            homepage: typeof manifest.homepage === "string" ? manifest.homepage : undefined,
          });
        }
      } catch {
        // Ignore optional package metadata that is unavailable on this platform.
      }
    }
  }
  for (const workspace of workspaces) {
    for (const collection of [
      workspace.dependencies,
      workspace.devDependencies,
      workspace.optionalDependencies,
    ]) {
      const selected = Object.fromEntries(
        Object.entries(collection ?? {}).filter(([name]) => runtimeRoots.has(name)),
      );
      await visitDependencies(selected);
    }
  }
  return [...packages.values()].sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  );
}

const packages = await readInstalledPackages();
const lines = [
  "# Call Nina third-party notices",
  "",
  `This inventory covers the ${String(packages.length)} package versions bundled into, or providing the Electron runtime for, the local application from the pinned pnpm lockfile. Build-only quality and packaging tools are excluded. Each dependency remains under its own license; consult the package metadata and upstream repository for the complete license text. This file is regenerated with ` +
    "`pnpm run generate:third-party-notices`.",
  "",
  "## Application and assets",
  "",
  "- The authored [licensing and attribution policy](licensing.md) and repository [LICENSE](../LICENSE) define original-material permissions, preserved MIT grants and branding rights. This generated dependency inventory does not set or replace that policy.",
  "- The curriculum snapshot is original or source-attributed content. Authoritative source links and freshness fields are maintained in `content/curriculum/sources.yaml`.",
  "- Researched curriculum is educational material, not formal CEFR certification, legal advice, immigration advice, or an official public-service determination.",
  "- Curriculum attribution: [Council of Europe CEFR Companion Volume](https://www.coe.int/en/web/common-european-framework-reference-languages/cefr-companion-volume-and-its-language-versions), [Bundesportal](https://verwaltung.bund.de/leistungsverzeichnis/DE/leistung/99115005104001/herausgeber/HH-S1000020010000000079/region/020000000000), and [Bundesmeldegesetz §17](https://www.gesetze-im-internet.de/bmg/__17.html), as listed in the source registry.",
  "",
  "## Installed package inventory",
  "",
  "| Package | Version | Declared license | Homepage |",
  "| --- | --- | --- | --- |",
  ...packages.map(
    (entry) =>
      `| \`${entry.name}\` | \`${entry.version}\` | ${entry.license.replaceAll("|", "\\|")} | ${entry.homepage ? `[upstream](${entry.homepage})` : "—"} |`,
  ),
  "",
  "## Release boundary",
  "",
  "The Linux AppImage includes this notice, the Call Nina licensing note, and the immutable curriculum/plugin/helper snapshot. It does not include learner data, credentials, or a Codex account. A compatible external Codex installation remains a prerequisite for AI actions.",
];
await writeFile(outputFile, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o644 });
process.stdout.write(
  `[PASS] THIRD_PARTY_NOTICES_GENERATED: ${String(packages.length)} package versions\n`,
);
