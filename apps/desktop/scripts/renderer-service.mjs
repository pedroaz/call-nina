#!/usr/bin/env node

import path from "node:path";
import { createServer } from "vite";

const desktopRoot = path.resolve(import.meta.dirname, "..");
const server = await createServer({
  configFile: path.join(desktopRoot, "vite.config.ts"),
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, async () => {
    await server.close();
    process.disconnect?.();
  });
}

await server.listen();
const address = server.httpServer.address();
if (!address || typeof address === "string") {
  await server.close();
  throw new Error("Desktop Vite server did not bind a TCP port.");
}
process.send(`http://127.0.0.1:${address.port}/`);
