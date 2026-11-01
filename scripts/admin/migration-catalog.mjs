import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ControlError } from "./configuration.mjs";

const directory = new URL("../../packages/managed-generation/sql/", import.meta.url);
export async function migrationCatalog() {
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter(({ name }) => name.endsWith(".sql"))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  if (!entries.length) throw new ControlError("Migration catalog is empty");
  return Promise.all(
    entries.map(async (entry, index) => {
      const match = /^(\d{3})-[a-z0-9-]+\.sql$/.exec(entry.name);
      if (!entry.isFile() || !match || Number(match[1]) !== index + 1)
        throw new ControlError(
          "Migrations require unique contiguous numeric prefixes starting at 001",
        );
      const source = await readFile(new URL(entry.name, directory), "utf8");
      if (!/^BEGIN;\r?$/m.test(source) || !/^COMMIT;\r?$/m.test(source))
        throw new ControlError(`Migration requires transaction boundaries: ${entry.name}`);
      return {
        name: entry.name,
        digest: createHash("sha256").update(source).digest("hex"),
        body: source.replace(/^BEGIN;\r?$/m, "").replace(/^COMMIT;\r?$/m, ""),
      };
    }),
  );
}
