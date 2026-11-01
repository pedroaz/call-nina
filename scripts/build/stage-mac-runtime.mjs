import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chmod, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Official https://nodejs.org/dist/v26.5.0/SHASUMS256.txt; updates are explicit.
const checksums = {
  arm64: "ee920559aaa2391569cff4d737e3b83963430e3a14dedd91bfe0ff53171b5af9",
  x64: "98293394c945a24e64e00b4177bf075ec963ea70b34d1d2e24bd4a71716d334f",
};
if (process.platform !== "darwin" || !checksums[process.arch])
  throw new Error("MAC_RUNTIME_PLATFORM_UNSUPPORTED");
const root = path.resolve(import.meta.dirname, "../..");
const output = path.join(root, "release/mac-runtime");
await mkdir(path.dirname(output), { recursive: true });
const scratch = await mkdtemp(path.join(root, "release/.mac-runtime-"));
try {
  const name = `node-v26.5.0-darwin-${process.arch}`;
  const response = await fetch(`https://nodejs.org/dist/v26.5.0/${name}.tar.gz`, {
    signal: AbortSignal.timeout(180_000),
    redirect: "error",
  });
  if (!response.ok || !response.body) throw new Error("MAC_RUNTIME_DOWNLOAD_FAILED");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 100 * 1024 * 1024) throw new Error("MAC_RUNTIME_DOWNLOAD_TOO_LARGE");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  if (createHash("sha256").update(bytes).digest("hex") !== checksums[process.arch])
    throw new Error("MAC_RUNTIME_CHECKSUM_MISMATCH");
  const archive = path.join(scratch, "node.tar.gz");
  await writeFile(archive, bytes);
  // Extract only reviewed members of this checksum-pinned archive.
  execFileSync("/usr/bin/tar", [
    "-xzf",
    archive,
    "-C",
    scratch,
    `${name}/bin/node`,
    `${name}/LICENSE`,
  ]);
  const next = path.join(scratch, "next");
  await mkdir(next);
  await cp(path.join(scratch, name, "bin/node"), path.join(next, "node"));
  await chmod(path.join(next, "node"), 0o755);
  await cp(path.join(scratch, name, "LICENSE"), path.join(next, "LICENSE"));
  execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", path.join(next, "node")], {
    stdio: "pipe",
  });
  await writeFile(
    path.join(next, "runtime.json"),
    JSON.stringify(
      {
        version: "26.5.0",
        platform: "darwin",
        arch: process.arch,
        minimumMacOS: "13.5",
        archiveSha256: checksums[process.arch],
        sha256: createHash("sha256")
          .update(await readFile(path.join(next, "node")))
          .digest("hex"),
      },
      null,
      2,
    ) + "\n",
  );
  await rm(output, { recursive: true, force: true });
  await rename(next, output);
  console.log(`MAC_RUNTIME_STAGED: 26.5.0 darwin-${process.arch}`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
