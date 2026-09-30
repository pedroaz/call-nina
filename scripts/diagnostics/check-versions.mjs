#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const manifests = [
  "package.json",
  "packages/managed-generation/package.json",
  "apps/managed-service/package.json",
  "apps/desktop/package.json",
  "apps/mcp-server/package.json",
  "packages/codex-client/package.json",
  "packages/offline-runtime/package.json",
  "packages/direct-api/package.json",
  "packages/learning-workflows/package.json",
  "packages/contracts/package.json",
  "packages/design-system/package.json",
  "packages/domain/package.json",
  "packages/persistence/package.json",
  "packages/platform/package.json",
  "plugins/call-nina/.codex-plugin/plugin.json",
];

const versions = await Promise.all(
  manifests.map(async (relative) => {
    const manifest = JSON.parse(await readFile(path.join(repositoryRoot, relative), "utf8"));
    if (typeof manifest.version !== "string") throw new Error(`OD_VERSION_MISSING:${relative}`);
    return { relative, version: manifest.version };
  }),
);
const expected = versions[0].version;
const mismatches = versions.filter(({ version }) => version !== expected);
if (mismatches.length) {
  throw new Error(
    `OD_VERSION_MISMATCH:${mismatches.map(({ relative, version }) => `${relative}=${version}`).join(",")}`,
  );
}
process.stdout.write(
  `[PASS] VERSION_ALIGNED: ${expected} across ${String(versions.length)} manifests\n`,
);
