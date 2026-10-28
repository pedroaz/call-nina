import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const output = path.join(root, "build/hosting/.vercel/output/functions/api");
for (const [name, method] of [
  ["account", "GET"],
  ["generate", "POST"],
  ["mobile-sync", "handle"],
]) {
  const directory = path.join(output, `${name}.func`);
  await mkdir(directory, { recursive: true });
  await build({
    stdin: {
      contents: `import { ${method} } from './api/${name}.ts';
export default { fetch(request) { ${method === "handle" ? "return handle(request);" : `return request.method === '${method}' ? ${method}(request) : new Response(null, { status: 405, headers: { allow: '${method}' } });`} } };`,
      resolveDir: path.join(root, "apps/api"),
      sourcefile: `${name}-entry.ts`,
      loader: "ts",
    },
    outfile: path.join(directory, "index.mjs"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    banner: {
      js: "import { createRequire as ninaCreateRequire } from 'node:module'; const require = ninaCreateRequire(import.meta.url);",
    },
    logLevel: "warning",
  });
  await writeFile(
    path.join(directory, ".vc-config.json"),
    `${JSON.stringify({ runtime: "nodejs24.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: true, supportsResponseStreaming: true, maxDuration: 150 }, null, 2)}\n`,
  );
  await writeFile(path.join(directory, "package.json"), '{"type":"module"}\n');
}
