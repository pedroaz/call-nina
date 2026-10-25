import { fileURLToPath } from "node:url";
import { generateCssTypes } from "../../../scripts/build/generate-css-types.mjs";

await generateCssTypes(
  fileURLToPath(new URL("../src/", import.meta.url)),
  fileURLToPath(new URL("../src/css-modules.d.ts", import.meta.url)),
);
