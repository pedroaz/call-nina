import { open } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { inspectMacBundle, native } from "./mac-bundle.mjs";

const report = {
  schemaVersion: 1,
  platform: process.platform,
  architecture: process.arch,
  node: process.versions.node,
  checks: [],
  startup: [],
};
try {
  report.macOS = native("/usr/bin/sw_vers", ["-productVersion"]).trim();
  report.bundle = await inspectMacBundle(path.resolve(import.meta.dirname, "../../.."));
  const [major, minor] = report.macOS.split(".").map(Number);
  report.compatibleOS = major > 13 || (major === 13 && minor >= 5);
} catch (error) {
  report.checks.push(/^MAC_[A-Z_]+$/.test(error.message) ? error.message : "MAC_INSPECTION_FAILED");
  process.exitCode = 1;
}
// Only allowlisted fields from our own bounded JSON startup log are exported.
let log;
try {
  log = await open(path.join(homedir(), "Library/Application Support/Call Nina/startup.log"), "r");
  const size = (await log.stat()).size;
  const bytes = Buffer.alloc(Math.min(size, 64 * 1024));
  await log.read(bytes, 0, bytes.length, Math.max(0, size - bytes.length));
  for (const line of bytes.toString("utf8").split("\n").slice(-100)) {
    try {
      const row = JSON.parse(line);
      if (
        /^DESKTOP_[A-Z_]+$/.test(row.code) &&
        /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(row.timestamp)
      ) {
        const safe = { timestamp: row.timestamp, code: row.code };
        for (const key of [
          "version",
          "commit",
          "run",
          "arch",
          "electron",
          "node",
          "os",
          "reason",
          "exitCode",
          "stage",
        ])
          if (typeof row[key] === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(row[key]))
            safe[key] = row[key];
        report.startup.push(safe);
      }
    } catch {
      /* Incomplete or foreign records are excluded. */
    }
  }
} catch {
  report.checks.push("MAC_STARTUP_LOG_UNAVAILABLE");
} finally {
  await log?.close();
}
report.preJavascriptFailure =
  "If no startup record matches the failed launch, inspect the matching macOS Diagnostic Report in Console locally; review private data before sharing.";
console.log(JSON.stringify(report, null, 2));
