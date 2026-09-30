#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";

import { designTokens } from "../../packages/design-system/src/index.ts";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--check")) {
  throw new Error("Usage: node scripts/build/generate-design-tokens.mjs [--check]");
}

const directory = new URL("../../packages/design-system/styles/", import.meta.url);
const target = new URL("tokens.css", directory);
const declarations = [];
const rem = (value) => `${value / 16}rem`;
const kebab = (value) => value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
function addGroup(prefix, values, convert = (value) => value) {
  for (const [name, value] of Object.entries(values)) {
    declarations.push(`  --od-${prefix}-${kebab(name)}: ${convert(value)};`);
  }
}
for (const [family, shades] of Object.entries(designTokens.palette)) {
  addGroup(`palette-${family}`, shades);
}
addGroup("color", designTokens.colors);
addGroup("space", designTokens.spacing, rem);
addGroup("radius", designTokens.radii, rem);
addGroup("border", designTokens.borders, rem);
addGroup("font-family", designTokens.typography.families);
addGroup("font-weight", designTokens.typography.weights);
for (const [name, value] of Object.entries(designTokens.typography.styles)) {
  declarations.push(`  --od-type-${kebab(name)}-size: ${rem(value.size)};`);
  declarations.push(`  --od-type-${kebab(name)}-line: ${rem(value.lineHeight)};`);
}
const shadowRgb = designTokens.colors.textStrong
  .slice(1)
  .match(/../g)
  .map((part) => Number.parseInt(part, 16))
  .join(", ");
addGroup(
  "shadow",
  designTokens.shadows,
  ({ x, y, blur, opacity }) => `${x}px ${y}px ${blur}px rgba(${shadowRgb}, ${opacity})`,
);
addGroup("motion-duration", designTokens.motion.durations, (value) => `${value}ms`);
addGroup("motion-ease", designTokens.motion.easing, (value) => `cubic-bezier(${value.join(", ")})`);
const css = [
  "/* Generated from packages/design-system/src/index.ts. Regenerate with make design-tokens. */",
  ":root {",
  ...declarations,
  "}",
  "@media (prefers-reduced-motion: reduce) {",
  "  :root {",
  ...Object.keys(designTokens.motion.durations).map(
    (name) => `    --od-motion-duration-${kebab(name)}: 0ms;`,
  ),
  "  }",
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
