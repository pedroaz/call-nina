import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inspectMacBundle, native } from "../diagnostics/mac-bundle.mjs";
const root = path.resolve(import.meta.dirname, "../..");
const output = path.join(root, "release/local");
const diagnostic = path.join(root, "build/release-diagnostics");
await mkdir(diagnostic, { recursive: true });
const report = {
  platform: process.platform,
  architecture: process.arch,
  node: process.version,
  checks: [],
};
try {
  report.macOS = native("/usr/bin/sw_vers", ["-productVersion"]).trim();
  report.xcode = native("/usr/bin/xcodebuild", ["-version"]).trim().replaceAll("\n", " ");
  report.unpacked = await inspectMacBundle(
    path.join(output, process.arch === "arm64" ? "mac-arm64" : "mac", "Call Nina.app"),
  );
  if (report.unpacked.architecture !== process.arch) throw new Error("MAC_RUNNER_ARCH_MISMATCH");
  const images = (await readdir(output)).filter((file) =>
    file.endsWith(`-darwin-${process.arch}.dmg`),
  );
  if (process.env.GITHUB_ACTIONS === "true" && images.length !== 1)
    throw new Error("MAC_DMG_MISSING_OR_AMBIGUOUS");
  if (images.length === 1) {
    const file = path.join(output, images[0]);
    native("/usr/bin/hdiutil", ["verify", file]);
    const mount = await mkdtemp(path.join(tmpdir(), "nina-inspect-"));
    let attached = false;
    try {
      native("/usr/bin/hdiutil", ["attach", "-readonly", "-nobrowse", "-mountpoint", mount, file]);
      attached = true;
      report.dmg = await inspectMacBundle(path.join(mount, "Call Nina.app"));
      if (JSON.stringify(report.dmg) !== JSON.stringify(report.unpacked))
        throw new Error("MAC_DMG_BUNDLE_MISMATCH");
    } finally {
      if (attached) native("/usr/bin/hdiutil", ["detach", mount]);
      await rm(mount, { recursive: true, force: true });
    }
  }
  report.checks.push("MAC_STRUCTURE_VALID_RUNTIME_UNVERIFIED");
} catch (error) {
  report.checks.push(/^MAC_[A-Z_]+$/.test(error.message) ? error.message : "MAC_INSPECTION_FAILED");
  process.exitCode = 1;
} finally {
  await writeFile(
    path.join(diagnostic, "mac-package.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report));
}
