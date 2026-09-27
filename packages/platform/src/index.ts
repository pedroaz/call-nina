import { execFile } from "node:child_process";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

// Pass paths as environment data, never interpolate them into PowerShell code.
export async function windowsPathPermissions(
  filename: string,
): Promise<{ owned: boolean; broad: boolean; writableByOthers: boolean }> {
  const script = `
$ErrorActionPreference = 'Stop'
$acl = Get-Acl -LiteralPath $env:OD_INSPECT_PATH
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
$trusted = @($sid, 'S-1-5-18', 'S-1-5-32-544')
$broad = $false; $write = $false
foreach ($rule in $acl.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])) {
  if ($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -notin $trusted) {
    $broad = $true
    if (([int]$rule.FileSystemRights -band 852310) -ne 0) { $write = $true }
  }
}
@{owned=($owner -eq $sid); broad=$broad; writableByOthers=$write} | ConvertTo-Json -Compress
`;
  try {
    const { stdout } = await execute(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        env: { ...process.env, OD_INSPECT_PATH: filename },
        windowsHide: true,
        timeout: 10_000,
      },
    );
    const value: unknown = JSON.parse(stdout);
    if (
      typeof value !== "object" ||
      value === null ||
      !("owned" in value) ||
      !("broad" in value) ||
      !("writableByOthers" in value) ||
      typeof value.owned !== "boolean" ||
      typeof value.broad !== "boolean" ||
      typeof value.writableByOthers !== "boolean"
    )
      throw new Error();
    return { owned: value.owned, broad: value.broad, writableByOthers: value.writableByOthers };
  } catch {
    throw new Error("OD_PATH_PERMISSIONS_UNAVAILABLE");
  }
}

export async function pathPermissions(filename: string) {
  if (process.platform === "win32") return windowsPathPermissions(filename);
  const metadata = await lstat(filename);
  return {
    owned: metadata.uid === process.getuid?.(),
    broad: (metadata.mode & 0o077) !== 0,
    writableByOthers: (metadata.mode & 0o022) !== 0,
  };
}

export async function assertOwnedPath(filename: string, privateOnly = false): Promise<void> {
  const metadata = await lstat(filename);
  const permissions = await pathPermissions(filename);
  if (
    metadata.isSymbolicLink() ||
    !permissions.owned ||
    permissions.writableByOthers ||
    (privateOnly && permissions.broad)
  )
    throw new Error("OD_PATH_OWNERSHIP_UNSAFE");
}

export async function assertNoLinks(filename: string): Promise<void> {
  if (!path.isAbsolute(filename) || filename.includes("\0")) throw new Error("OD_PATH_INVALID");
  const normalized = path.normalize(filename);
  const root = path.parse(normalized).root;
  let cursor = root;
  for (const segment of normalized.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      const metadata = await lstat(cursor);
      if (metadata.isSymbolicLink()) throw new Error("OD_PATH_LINK_UNSAFE");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

export async function syncDirectory(directory: string): Promise<void> {
  // Windows does not expose directory handles through fs.open; file data was
  // already fsynced before the atomic rename by the caller.
  if (process.platform === "win32") return;
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// A content inventory gives uninstall evidence for individual generated files;
// an ownership marker alone never authorizes recursive directory deletion.
export async function writeOwnedTreeInventory(root: string): Promise<void> {
  const { createHash } = await import("node:crypto");
  const { readFile, readdir, writeFile } = await import("node:fs/promises");
  const files: { name: string; sha256: string }[] = [];
  const directories: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("OD_OWNED_TREE_LINK_UNSAFE");
      if (entry.isDirectory()) {
        directories.push(path.relative(root, filename));
        await visit(filename);
      } else if (entry.isFile())
        files.push({
          name: path.relative(root, filename),
          sha256: createHash("sha256")
            .update(await readFile(filename))
            .digest("hex"),
        });
      else throw new Error("OD_OWNED_TREE_FILE_INVALID");
    }
  }
  await visit(root);
  await writeFile(
    path.join(root, "owned-files.json"),
    JSON.stringify({ kind: "call-nina-plugin-runtime", schemaVersion: 1, files, directories }),
    { mode: 0o600, flag: "wx" },
  );
}

export async function removeOwnedTree(root: string): Promise<boolean> {
  const { createHash } = await import("node:crypto");
  const { readFile, readdir, rmdir, unlink } = await import("node:fs/promises");
  await assertNoLinks(root);
  await assertOwnedPath(root, true);
  const inventoryFile = path.join(root, "owned-files.json");
  await assertOwnedPath(inventoryFile, true);
  const raw: unknown = JSON.parse(await readFile(inventoryFile, "utf8"));
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("kind" in raw) ||
    raw.kind !== "call-nina-plugin-runtime" ||
    !("schemaVersion" in raw) ||
    raw.schemaVersion !== 1 ||
    !("files" in raw) ||
    !Array.isArray(raw.files) ||
    !("directories" in raw) ||
    !Array.isArray(raw.directories)
  )
    throw new Error("OD_OWNED_TREE_INVENTORY_INVALID");
  const files = raw.files.map((file: unknown) => {
    if (
      typeof file !== "object" ||
      file === null ||
      !("name" in file) ||
      typeof file.name !== "string" ||
      !("sha256" in file) ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(file.sha256)
    )
      throw new Error("OD_OWNED_TREE_INVENTORY_INVALID");
    const relative = path.relative(root, path.resolve(root, file.name));
    if (
      !relative ||
      relative.startsWith("..") ||
      path.isAbsolute(relative) ||
      relative === "owned-files.json"
    )
      throw new Error("OD_OWNED_TREE_INVENTORY_INVALID");
    return { filename: path.join(root, relative), sha256: file.sha256 };
  });
  const directories = raw.directories
    .map((name: unknown) => {
      if (typeof name !== "string") throw new Error("OD_OWNED_TREE_INVENTORY_INVALID");
      const relative = path.relative(root, path.resolve(root, name));
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error("OD_OWNED_TREE_INVENTORY_INVALID");
      return relative;
    })
    .sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);
  for (const file of files) {
    await assertNoLinks(file.filename);
    const metadata = await lstat(file.filename).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    });
    if (
      metadata?.isFile() &&
      createHash("sha256")
        .update(await readFile(file.filename))
        .digest("hex") === file.sha256
    )
      await unlink(file.filename);
  }
  for (const relative of directories) {
    const directory = path.join(root, relative);
    await assertNoLinks(directory);
    await rmdir(directory).catch((error: unknown) => {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        (error.code !== "ENOTEMPTY" && error.code !== "ENOENT")
      )
        throw error;
    });
  }
  if ((await readdir(root)).some((name) => name !== "owned-files.json")) return false;
  await unlink(inventoryFile);
  await rmdir(root);
  return true;
}
