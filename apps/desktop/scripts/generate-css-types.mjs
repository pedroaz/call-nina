import { fileURLToPath } from "node:url";
import { generateCssTypes } from "../../../scripts/build/generate-css-types.mjs";

await generateCssTypes(
  fileURLToPath(new URL("../src/renderer/", import.meta.url)),
  fileURLToPath(new URL("../src/renderer/styles/css-modules.d.ts", import.meta.url)),
);
