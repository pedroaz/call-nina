import { lstat } from "node:fs/promises";
import path from "node:path";
import type { personalDataOverviewSchema, z } from "@call-nina/contracts";
import { resolveDataRootLayout } from "@call-nina/persistence";

type Location = z.infer<typeof personalDataOverviewSchema>["locations"][number];

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
      bytes: metadata.isFile() ? metadata.size : null,
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
    ["bootstrap", configRoot, bootstrapFile],
    ["appConfig", configRoot, configRoot],
  ];
  return Promise.all(entries.map(([id, base, target]) => describeLocation(id, base, target)));
}
