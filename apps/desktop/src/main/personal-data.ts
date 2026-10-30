import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { personalDataOverviewSchema, z } from "@call-nina/contracts";
import { resolveDataRootLayout } from "@call-nina/persistence";

type Location = z.infer<typeof personalDataOverviewSchema>["locations"][number];

async function measuredBytes(target: string, seen = new Set<string>()): Promise<number> {
  const info = await lstat(target);
  // Count regular bytes once; CPython preparation aliases never get traversed.
  if (info.isSymbolicLink()) return 0;
  if (info.isFile()) {
    const identity = `${String(info.dev)}:${String(info.ino)}`;
    if (seen.has(identity)) return 0;
    seen.add(identity);
    return info.size;
  }
  if (!info.isDirectory()) throw new Error("OD_STORAGE_ENTRY_UNSAFE");
  let bytes = 0;
  for (const name of await readdir(target)) {
    try {
      bytes += await measuredBytes(path.join(target, name), seen);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return bytes;
}

async function describeLocation(
  id: Location["id"],
  base: string,
  target: string,
): Promise<Location> {
  try {
    // Inspect each component without traversing links, including optional research folders.
    const components = path.relative(base, target).split(path.sep).filter(Boolean);
    let current = base;
    let metadata = await lstat(current);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      return { id, path: target, status: "unavailable", bytes: null };
    }
    for (const [index, component] of components.entries()) {
      current = path.join(current, component);
      metadata = await lstat(current);
      if (metadata.isSymbolicLink() || (index < components.length - 1 && !metadata.isDirectory())) {
        return { id, path: target, status: "unavailable", bytes: null };
      }
    }
    return {
      id,
      path: target,
      status: metadata.isFile() ? "file" : metadata.isDirectory() ? "directory" : "unavailable",
      bytes: await measuredBytes(target),
    };
  } catch (error) {
    return {
      id,
      path: target,
      status: (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable",
      bytes: null,
    };
  }
}

export async function readPersonalDataLocations(dataRoot: string, bootstrapFile: string) {
  const layout = resolveDataRootLayout(dataRoot);
  const configRoot = path.dirname(bootstrapFile);
  const entries: Array<[Location["id"], string, string]> = [
    ["database", dataRoot, layout.database],
    ["attachments", dataRoot, layout.attachments],
    ["textModels", dataRoot, layout.textModels],
    ["speechModels", dataRoot, path.join(layout.speech, "models")],
    ["preparedSpeech", dataRoot, layout.preparedSpeech],
    ["curriculumAudio", dataRoot, path.join(layout.speech, "curriculum")],
    ["privateAudio", dataRoot, layout.privateAudio],
    ["logs", dataRoot, layout.logs],
    ["diagnostics", dataRoot, layout.diagnostics],
    ["bootstrap", configRoot, bootstrapFile],
    ["appConfig", configRoot, configRoot],
  ];
  return Promise.all(entries.map(([id, base, target]) => describeLocation(id, base, target)));
}
