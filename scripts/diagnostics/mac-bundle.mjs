// Read-only native inspection shared by CI and the installed diagnostic command.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, open, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

export function native(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch {
    throw new Error(`MAC_TOOL_FAILED_${path.basename(command).replaceAll("-", "_").toUpperCase()}`);
  }
}
function requireValue(condition, code) {
  if (!condition) throw new Error(code);
}
function within(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
export function plist(file) {
  return JSON.parse(native("/usr/bin/plutil", ["-convert", "json", "-o", "-", file]));
}
export async function fuseValues(bundle) {
  const bytes = await readFile(
    path.join(bundle, "Contents/Frameworks/Electron Framework.framework/Electron Framework"),
  );
  // Electron's documented V1 fuse wire, also used by @electron/fuses 1.8.0.
  const sentinel = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");
  const index = bytes.indexOf(sentinel);
  requireValue(index >= 0 && index === bytes.lastIndexOf(sentinel), "MAC_FUSE_WIRE_INVALID");
  const offset = index + sentinel.length;
  requireValue(bytes[offset] === 1 && bytes[offset + 1] >= 8, "MAC_FUSE_VERSION_INVALID");
  const expected = { 0: 49, 2: 48, 3: 48, 4: 49, 5: 49, 7: 49 };
  for (const [key, value] of Object.entries(expected))
    requireValue(bytes[offset + 2 + Number(key)] === value, "MAC_FUSE_VALUE_INVALID");
  return {
    runAsNode: true,
    nodeOptions: false,
    nodeInspect: false,
    asarIntegrity: true,
    onlyAsar: true,
    filePrivileges: true,
  };
}
// Parse thin 64-bit Mach-O load commands directly: installed diagnostics need no Xcode tools.
async function inspectMachO(file) {
  const handle = await open(file, "r");
  try {
    const header = Buffer.alloc(32);
    requireValue(
      (await handle.read(header, 0, 32, 0)).bytesRead === 32 &&
        header.readUInt32LE(0) === 0xfeedfacf,
      "MAC_MACH_HEADER_INVALID",
    );
    const cpu = header.readUInt32LE(4);
    const arch = cpu === 0x0100000c ? "arm64" : cpu === 0x01000007 ? "x86_64" : "unknown";
    const count = header.readUInt32LE(16),
      size = header.readUInt32LE(20);
    requireValue(
      size > 0 && size <= 16 * 1024 * 1024 && count <= 10000,
      "MAC_MACH_COMMANDS_INVALID",
    );
    const commands = Buffer.alloc(size);
    requireValue(
      (await handle.read(commands, 0, size, 32)).bytesRead === size,
      "MAC_MACH_COMMANDS_INVALID",
    );
    let offset = 0,
      minimum = null;
    const dependencies = [];
    for (let index = 0; index < count; index++) {
      requireValue(offset + 8 <= size, "MAC_MACH_COMMANDS_INVALID");
      const command = commands.readUInt32LE(offset),
        length = commands.readUInt32LE(offset + 4);
      requireValue(length >= 8 && offset + length <= size, "MAC_MACH_COMMANDS_INVALID");
      if (command === 0x32) {
        requireValue(
          length >= 24 && commands.readUInt32LE(offset + 8) === 1,
          "MAC_MACH_PLATFORM_INVALID",
        );
        minimum = commands.readUInt32LE(offset + 12);
      } else if (command === 0x24) {
        requireValue(length >= 16, "MAC_MACH_COMMANDS_INVALID");
        minimum = commands.readUInt32LE(offset + 8);
      } else if ([0xc, 0x80000018, 0x8000001f, 0x20, 0x80000023].includes(command)) {
        requireValue(length >= 24, "MAC_MACH_COMMANDS_INVALID");
        const start = commands.readUInt32LE(offset + 8);
        const end = commands.indexOf(0, offset + start);
        requireValue(
          start >= 24 && start < length && end >= offset + start && end < offset + length,
          "MAC_MACH_DEPENDENCY_INVALID",
        );
        dependencies.push(commands.toString("utf8", offset + start, end));
      }
      offset += length;
    }
    requireValue(offset === size, "MAC_MACH_COMMANDS_INVALID");
    return { arch, minimum, dependencies, executable: header.readUInt32LE(12) === 2 };
  } finally {
    await handle.close();
  }
}
export function signatureDetails(bundle) {
  const result = spawnSync("/usr/bin/codesign", ["--display", "--verbose=4", bundle], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  requireValue(result.status === 0, "MAC_SIGNATURE_DETAILS_UNAVAILABLE");
  const details = result.stderr;
  requireValue(/Signature=adhoc/.test(details), "MAC_SIGNATURE_NOT_ADHOC");
  requireValue(!/flags=.*\bruntime\b/.test(details), "MAC_HARDENED_RUNTIME_UNEXPECTED");
  const entitlements = spawnSync(
    "/usr/bin/codesign",
    ["--display", "--entitlements", ":-", bundle],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  requireValue(entitlements.status === 0, "MAC_ENTITLEMENTS_UNAVAILABLE");
  return { adHoc: true, hardenedRuntime: false, entitlementsInspected: true };
}
export async function inspectMacBundle(input) {
  requireValue(process.platform === "darwin", "MAC_INSPECTION_REQUIRES_MAC");
  const bundle = await realpath(input);
  const contents = path.join(bundle, "Contents");
  const resources = path.join(contents, "Resources");
  const info = plist(path.join(contents, "Info.plist"));
  requireValue(
    info.CFBundleIdentifier === "dev.callnina.app" && info.LSMinimumSystemVersion === "13.5",
    "MAC_BUNDLE_IDENTITY_INVALID",
  );
  requireValue(
    info.CFBundleURLTypes?.some((type) => type.CFBundleURLSchemes?.includes("call-nina")),
    "MAC_PROTOCOL_MISSING",
  );
  requireValue(
    typeof info.CFBundleIconFile === "string" && !info.CFBundleIconFile.includes("/"),
    "MAC_ICON_INVALID",
  );
  const icon = info.CFBundleIconFile.endsWith(".icns")
    ? info.CFBundleIconFile
    : `${info.CFBundleIconFile}.icns`;
  const required = [
    icon,
    "app.asar",
    "curriculum/catalog.json",
    "plugin/.codex-plugin/plugin.json",
    "mcp-helper/server/index.js",
    "mcp-helper/build-info.json",
    "mcp-helper/call-nina-mcp.cjs",
    "mac-runtime/node",
    "mac-runtime/LICENSE",
    "mac-runtime/runtime.json",
    "diagnostics/mac-diagnostics.mjs",
    "diagnostics/mac-bundle.mjs",
    "notices/LICENSE",
    "notices/THIRD-PARTY-NOTICES.md",
  ];
  for (const name of required)
    requireValue((await lstat(path.join(resources, name))).isFile(), "MAC_RESOURCE_MISSING");
  const runtime = JSON.parse(
    await readFile(path.join(resources, "mac-runtime/runtime.json"), "utf8"),
  );
  requireValue(
    ["arm64", "x64"].includes(runtime.arch) &&
      runtime.version === "26.5.0" &&
      runtime.minimumMacOS === "13.5",
    "MAC_RUNTIME_METADATA_INVALID",
  );
  requireValue(
    createHash("sha256")
      .update(await readFile(path.join(resources, "mac-runtime/node")))
      .digest("hex") === runtime.sha256,
    "MAC_RUNTIME_DIGEST_INVALID",
  );
  requireValue(
    (await lstat(path.join(resources, "mac-runtime/node"))).size < 150 * 1024 * 1024,
    "MAC_RUNTIME_SIZE_EXCEEDED",
  );
  const build = JSON.parse(
    await readFile(path.join(resources, "mcp-helper/build-info.json"), "utf8"),
  );
  requireValue(
    build.version === info.CFBundleShortVersionString &&
      build.arch === runtime.arch &&
      build.platform === "darwin" &&
      /^(?:local|[a-f0-9]{40})$/.test(build.commit) &&
      /^(?:local|[0-9]+)$/.test(build.run),
    "MAC_BUILD_METADATA_INVALID",
  );
  const arch = runtime.arch === "x64" ? "x86_64" : "arm64";
  let binaries = 0;
  let links = 0;
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        requireValue(within(bundle, await realpath(file)), "MAC_LINK_ESCAPES_BUNDLE");
        links++;
      } else if (entry.isDirectory()) await walk(file);
      else if (entry.isFile()) {
        const handle = await open(file, "r");
        const header = Buffer.alloc(4);
        try {
          await handle.read(header, 0, 4, 0);
        } finally {
          await handle.close();
        }
        if (!["cffaedfe", "feedfacf", "cafebabe", "bebafeca"].includes(header.toString("hex")))
          continue;
        const binary = await inspectMachO(file);
        requireValue(binary.arch === arch, "MAC_BINARY_ARCH_INVALID");
        requireValue(
          binary.minimum !== null && binary.minimum <= 13 * 65536 + 5 * 256,
          "MAC_BINARY_MINIMUM_OS_INVALID",
        );
        requireValue(
          binary.dependencies.every(
            (item) =>
              item.startsWith("/System/Library/") ||
              item.startsWith("/usr/lib/") ||
              (file !== path.join(resources, "mac-runtime/node") &&
                /^@(rpath|loader_path|executable_path)\//.test(item)),
          ),
          "MAC_BINARY_DEPENDENCY_INVALID",
        );
        if (binary.executable)
          requireValue(((await lstat(file)).mode & 0o111) !== 0, "MAC_EXECUTABLE_MODE_INVALID");
        native("/usr/bin/codesign", ["--verify", "--strict", file]);
        signatureDetails(file);
        binaries++;
      } else throw new Error("MAC_BUNDLE_ENTRY_INVALID");
    }
  }
  await walk(contents);
  for (const executable of [
    path.join(contents, "MacOS", info.CFBundleExecutable),
    path.join(resources, "mac-runtime/node"),
  ])
    requireValue(((await lstat(executable)).mode & 0o111) !== 0, "MAC_EXECUTABLE_MODE_INVALID");
  native("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
  // The Info.plist seals the ASAR header digest; codesign seals the bundle.
  const asar = await open(path.join(resources, "app.asar"), "r");
  try {
    const prefix = Buffer.alloc(16);
    await asar.read(prefix, 0, 16, 0);
    const length = prefix.readUInt32LE(12);
    requireValue(length > 0 && length < 16 * 1024 * 1024, "MAC_ASAR_HEADER_INVALID");
    const header = Buffer.alloc(length);
    const read = await asar.read(header, 0, length, 16);
    requireValue(read.bytesRead === length, "MAC_ASAR_HEADER_INVALID");
    const integrity = info.ElectronAsarIntegrity?.["Resources/app.asar"];
    requireValue(
      integrity?.algorithm === "SHA256" &&
        integrity.hash === createHash("sha256").update(header).digest("hex"),
      "MAC_ASAR_INTEGRITY_INVALID",
    );
  } finally {
    await asar.close();
  }
  return {
    signature: signatureDetails(bundle),
    commit: build.commit,
    run: build.run,
    architecture: runtime.arch,
    minimumMacOS: "13.5",
    version: info.CFBundleShortVersionString,
    binaries,
    links,
    fuses: await fuseValues(bundle),
    runtimeVerification: "pending",
  };
}
