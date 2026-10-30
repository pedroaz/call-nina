import { constants, type Stats } from "node:fs";
import {
  lstat,
  mkdir,
  readdir,
  rmdir,
  link,
  unlink,
  open,
  rename,
  readlink,
  symlink,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { assertNoLinks, assertOwnedPath, syncDirectory } from "@call-nina/platform";
import { resolveDataRootLayout } from "./data-root-layout.js";

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";
async function metadata(file: string) {
  return lstat(file).catch((error: unknown) => {
    if (missing(error)) return null;
    throw error;
  });
}
async function digest(file: string) {
  const hash = createHash("sha256");
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false }))
      hash.update(chunk as Buffer);
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function copyCheckpoint(source: string, destination: string, info: Stats) {
  const key = createHash("sha256").update(source).digest("hex");
  const temporary = path.join(path.dirname(destination), `.migration-${key}.part`);
  const journal = `${temporary}.json`;
  const marker = JSON.stringify({
    kind: "call-nina-asset-copy",
    version: 1,
    source: key,
    dev: info.dev,
    ino: info.ino,
    bytes: info.size,
    modified: info.mtimeMs,
  });
  if (await metadata(journal)) {
    await assertOwnedPath(journal);
    const handle = await open(journal, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if ((await handle.stat()).size > 512 || (await handle.readFile("utf8")) !== marker)
        throw new Error("OD_STORAGE_MIGRATION_CONFLICT");
    } finally {
      await handle.close();
    }
    if (await metadata(temporary)) {
      await assertOwnedPath(temporary);
      if (!(await lstat(temporary)).isFile()) throw new Error("OD_STORAGE_MIGRATION_UNSAFE");
      await unlink(temporary);
    }
    await unlink(journal);
  } else if (await metadata(temporary)) throw new Error("OD_STORAGE_MIGRATION_CONFLICT");
  return { temporary, journal, marker };
}

// Only callers' known application-owned trees enter here. Never follow links,
// overwrite a conflicting destination, or remove a source before durable delivery.
async function moveTree(source: string, destination: string, treeRoot = source): Promise<void> {
  const info = await metadata(source);
  if (!info) return;
  if (info.isSymbolicLink()) {
    // CPython build scratch has relative aliases. Preserve them without following
    // links; reject anything pointing outside the source tree.
    await assertNoLinks(path.dirname(source));
    await assertNoLinks(path.dirname(destination));
    const target = await readlink(source);
    const relative = path.relative(treeRoot, path.resolve(path.dirname(source), target));
    if (
      info.uid !== process.getuid?.() ||
      path.isAbsolute(target) ||
      relative.startsWith("..") ||
      path.isAbsolute(relative)
    )
      throw new Error("OD_STORAGE_MIGRATION_UNSAFE");
    const prior = await metadata(destination);
    if (prior) {
      if (!prior.isSymbolicLink() || (await readlink(destination)) !== target)
        throw new Error("OD_STORAGE_MIGRATION_CONFLICT");
    } else await symlink(target, destination);
    await syncDirectory(path.dirname(destination));
    await unlink(source);
    return;
  }
  await assertNoLinks(source);
  await assertNoLinks(destination);
  await assertOwnedPath(source);
  if (info.isDirectory()) {
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    if (!(await metadata(destination))) {
      try {
        await rename(source, destination);
        await syncDirectory(path.dirname(destination));
        await syncDirectory(path.dirname(source));
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      }
    }
    await mkdir(destination, { recursive: true, mode: 0o700 });
    await assertOwnedPath(destination, true);
    for (const name of await readdir(source))
      await moveTree(path.join(source, name), path.join(destination, name), treeRoot);
    await rmdir(source);
    await syncDirectory(path.dirname(source));
    return;
  }
  const checkpoint = await copyCheckpoint(source, destination, info);
  const prior = await metadata(destination);
  // Unlinking an owned source path is safe even when a build tool used
  // hardlinks. Never mutate the source inode or its other names.
  if (!info.isFile()) throw new Error("OD_STORAGE_MIGRATION_UNSAFE");
  if (prior) {
    await assertOwnedPath(destination);
    if (
      !prior.isFile() ||
      prior.size !== info.size ||
      (prior.mode & 0o700) !== (info.mode & 0o700) ||
      (await digest(source)) !== (await digest(destination))
    )
      throw new Error("OD_STORAGE_MIGRATION_CONFLICT");
  } else {
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    try {
      // link() is exclusive and preserves executable modes without recopying GBs.
      await link(source, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
      const { temporary, journal, marker } = checkpoint;
      const record = await open(
        journal,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await record.writeFile(marker);
        await record.sync();
      } finally {
        await record.close();
      }
      await syncDirectory(path.dirname(journal));
      try {
        const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const output = await open(
            temporary,
            constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
            info.mode & 0o777,
          );
          try {
            await pipeline(
              input.createReadStream({ autoClose: false }),
              output.createWriteStream({ autoClose: false }),
            );
            await output.sync();
          } finally {
            await output.close();
          }
        } finally {
          await input.close();
        }
        if ((await digest(source)) !== (await digest(temporary)))
          throw new Error("OD_STORAGE_MIGRATION_CHANGED");
        await link(temporary, destination);
      } finally {
        await unlink(temporary).catch((cleanup: unknown) => {
          if (!missing(cleanup)) throw cleanup;
        });
        await unlink(journal);
      }
    }
  }
  await syncDirectory(path.dirname(destination));
  await unlink(source);
  await syncDirectory(path.dirname(source));
}

async function exclusive<T>(identity: string, action: () => Promise<T>): Promise<T> {
  const mutex = createServer((socket) => socket.destroy());
  const key = createHash("sha256").update(identity).digest("hex");
  // Migration is Linux-only because these legacy local runtimes target Linux x64.
  await new Promise<void>((resolve, reject) => {
    mutex.once("error", () => {
      reject(new Error("OD_STORAGE_MIGRATION_BUSY"));
    });
    mutex.listen(`\0nina-storage-${key}`, resolve);
  });
  try {
    return await action();
  } finally {
    await new Promise<void>((resolve) =>
      mutex.close(() => {
        resolve();
      }),
    );
  }
}

export async function consolidatePreparedSpeech(dataRoot: string, source: string) {
  const destination = resolveDataRootLayout(dataRoot).preparedSpeech;
  await assertNoLinks(dataRoot);
  await assertOwnedPath(dataRoot);
  if (source === destination || !(await metadata(source))) return;
  await exclusive(source, async () => {
    // Share the preparer's mutex so an active runtime build cannot be moved.
    const mutex = createServer((socket) => socket.destroy());
    await new Promise<void>((resolve, reject) => {
      mutex.once("error", () => {
        reject(new Error("OD_STORAGE_MIGRATION_BUSY"));
      });
      mutex.listen(
        `\0nina-speech-prepare-${createHash("sha256").update(source).digest("hex")}`,
        resolve,
      );
    });
    try {
      await moveTree(source, destination);
    } finally {
      await new Promise<void>((resolve) =>
        mutex.close(() => {
          resolve();
        }),
      );
    }
  });
}

export async function consolidateLocalAssets(dataRoot: string, configRoot: string) {
  if (process.platform !== "linux") return;
  const layout = resolveDataRootLayout(dataRoot);
  await assertNoLinks(dataRoot);
  await assertOwnedPath(dataRoot);
  await exclusive(configRoot, async () => {
    await moveTree(path.join(configRoot, "offline"), layout.textModels);
    for (const name of ["models", "candidate-models", "curriculum"])
      await moveTree(path.join(configRoot, "speech", name), path.join(layout.speech, name));
    await moveTree(
      path.join(layout.speech, "candidate-models"),
      path.join(layout.speech, "models"),
    );
    for (const engine of ["piper", "pocket"])
      for (const language of ["de", "en-US", "pt-BR", "es"]) {
        const id = `${engine}-${language}`;
        // Preserve runtime-generated files outside the strictly owned voice inventory.
        await moveTree(
          path.join(layout.speech, "models", id, ".cache"),
          path.join(layout.speech, "models", "worker-homes", id, ".cache"),
        );
      }
    // Leave any unrecognised files alone.
    await rmdir(path.join(configRoot, "speech")).catch((error: unknown) => {
      if (!missing(error) && (error as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw error;
    });
  });
}
