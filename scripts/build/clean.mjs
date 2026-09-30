#!/usr/bin/env node

import { rm } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const generated = [
  "release",
  "apps/desktop/dist",
  "apps/desktop/build",
  "apps/mcp-server/dist",
  "apps/mcp-server/build",
  "apps/website/dist",
  "apps/website/build",
  "apps/mobile/dist",
  "apps/mobile/build",
  "packages/codex-client/dist",
  "packages/direct-api/dist",
  "packages/learning-workflows/dist",
  "packages/contracts/dist",
  "packages/design-system/dist",
  "packages/domain/dist",
  "packages/persistence/dist",
  "packages/platform/dist",
  "apps/desktop/tsconfig.main.tsbuildinfo",
  "apps/desktop/tsconfig.preload.tsbuildinfo",
  "apps/desktop/tsconfig.renderer.tsbuildinfo",
  "apps/mcp-server/tsconfig.tsbuildinfo",
  "packages/codex-client/tsconfig.tsbuildinfo",
  "packages/direct-api/tsconfig.tsbuildinfo",
  "packages/learning-workflows/tsconfig.tsbuildinfo",
  "packages/contracts/tsconfig.tsbuildinfo",
  "packages/design-system/tsconfig.tsbuildinfo",
  "packages/domain/tsconfig.tsbuildinfo",
  "packages/persistence/tsconfig.tsbuildinfo",
  "packages/platform/tsconfig.tsbuildinfo",
];

for (const relative of generated) {
  const target = path.resolve(repositoryRoot, relative);
  const relation = path.relative(repositoryRoot, target);
  if (!relation || relation.startsWith("..") || path.isAbsolute(relation)) {
    throw new Error("OD_CLEAN_TARGET_INVALID");
  }
  await rm(target, { recursive: true, force: true });
}

process.stdout.write(`[PASS] GENERATED_OUTPUT_REMOVED: ${String(generated.length)} targets\n`);
