#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";

import { designTokens } from "../../packages/design-system/src/index.ts";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
  throw new Error("Usage: node scripts/build/generate-design-tokens.mjs [--check]");
}

const directory = new URL("../../packages/design-system/styles/", import.meta.url);
const target = new URL("tokens.css", directory);
const declarations = [
  ...Object.entries(designTokens.colors).map(([name, value]) => {
    const suffix = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    return `  --od-color-${suffix}: ${value};`;
  }),
  ...Object.entries(designTokens.spacing).map(
    ([name, value]) => `  --od-space-${name}: ${value / 16}rem;`,
  ),
  ...Object.entries(designTokens.radii).map(
    ([name, value]) => `  --od-radius-${name}: ${value / 16}rem;`,
  ),
];
const css = [
  "/* Generated from packages/design-system/src/index.ts. Regenerate with make design-tokens. */",
  ":root {",
  ...declarations,
  "}",
  "",
].join("\n");

if (args[0] === "--check") {
  const current = await readFile(target, "utf8").catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (current !== css) {
    process.stderr.write("[FAIL] DESIGN_TOKENS_STALE: run make design-tokens\n");
    process.exitCode = 1;
  } else {
    process.stdout.write("[PASS] DESIGN_TOKENS_CURRENT\n");
  }
} else {
  await mkdir(directory, { recursive: true });
  await writeFile(target, css);
  process.stdout.write("[PASS] DESIGN_TOKENS_GENERATED\n");
}
