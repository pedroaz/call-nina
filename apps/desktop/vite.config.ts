import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import {
  clientConfigurationAlias,
  requireClientConfiguration,
} from "../../scripts/lib/hosting-environment.mjs";

requireClientConfiguration();

export default defineConfig({
  resolve: { alias: [clientConfigurationAlias()] },
  root: import.meta.dirname,
  base: "./",
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  plugins: [react()],
  build: {
    outDir: "dist/renderer",
    emptyOutDir: true,
  },
});
