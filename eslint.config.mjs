import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import-x";
import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { builtinModules } from "node:module";
import tseslint from "typescript-eslint";

import callNina from "./scripts/eslint-rules/call-nina.mjs";

const typeScriptFiles = ["**/*.{ts,tsx}"];
const rendererFiles = ["apps/desktop/src/renderer/**/*.{ts,tsx}", "apps/website/src/**/*.{ts,tsx}"];
const electronFiles = ["apps/desktop/src/{main,preload}/**/*.{ts,tsx}"];

const scopedTypeScriptConfigs = tseslint.configs.strictTypeChecked.map((config) => ({
  ...config,
  files: typeScriptFiles,
}));

export default tseslint.config(
  {
    name: "call-nina/ignores",
    ignores: [
      "**/dist/**",
      "apps/*/build/**",
      "packages/*/build/**",
      "**/out/**",
      "**/release/**",
      "apps/mobile/.expo/**",
      "apps/mobile/android/**",
      "apps/mobile/ios/**",
      "node_modules/**",
    ],
  },
  {
    ...js.configs.recommended,
    name: "call-nina/javascript",
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  ...scopedTypeScriptConfigs,
  {
    name: "call-nina/typescript",
    files: typeScriptFiles,
    plugins: {
      "import-x": importPlugin,
      "call-nina": callNina,
    },
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "apps/desktop/vite*.config.ts",
            "apps/mcp-server/vite.config.ts",
            "packages/codex-client/src/environment.d.ts",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-argument": "error",
      "@typescript-eslint/no-unsafe-assignment": "error",
      "@typescript-eslint/no-unsafe-call": "error",
      "@typescript-eslint/no-unsafe-member-access": "error",
      "@typescript-eslint/no-unsafe-return": "error",
      "import-x/first": "error",
      "import-x/newline-after-import": "error",
      "import-x/no-duplicates": ["error", { "prefer-inline": true }],
      "call-nina/enforce-package-boundaries": "error",
    },
  },
  {
    name: "call-nina/renderer-react-accessibility",
    files: rendererFiles,
    plugins: {
      react,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: "19.0" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat["jsx-runtime"].rules,
      ...reactHooks.configs.flat["recommended-latest"].rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "call-nina/no-direct-react-aria-controls": "error",
    },
  },
  {
    name: "call-nina/mobile-react",
    files: ["apps/mobile/src/**/*.{ts,tsx}"],
    plugins: { react, "react-hooks": reactHooks },
    settings: { react: { version: "19.2" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat["jsx-runtime"].rules,
      ...reactHooks.configs.flat["recommended-latest"].rules,
      "no-restricted-imports": [
        "error",
        {
          paths: builtinModules.map((name) => ({
            name,
            message: "Mobile cannot use Node.js builtins.",
          })),
          patterns: [
            {
              group: ["node:*", "electron", "electron/*"],
              message: "Mobile cannot use desktop runtimes.",
            },
            {
              regex:
                "^@call-nina/(?!design-system(?:$|/font-notices\\.json$|/fonts/[^/]+\\.ttf$|/brand/[^/]+\\.png$)).+",
              message: "Mobile currently consumes only the portable design foundation.",
            },
            {
              group: ["../**/packages/**", "../**/apps/**"],
              message: "Consume shared code through its public workspace export.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "call-nina/electron-security",
    files: electronFiles,
    plugins: { "call-nina": callNina },
    rules: {
      "call-nina/no-electron-remote": "error",
      "call-nina/secure-electron-preferences": "error",
    },
  },
  {
    ...prettier,
    name: "call-nina/prettier-compatibility",
  },
);
