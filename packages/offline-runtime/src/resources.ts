import { readFile } from "node:fs/promises";
import { freemem, totalmem } from "node:os";
import { type OfflinePreflight } from "@call-nina/contracts";
import { fail } from "./files.js";

export async function availableMemory() {
  const valid = (bytes: number) => Number.isSafeInteger(bytes) && bytes >= 0;
  let totalMemoryBytes: number | null = null;
  let freeMemoryBytes: number | null = null;
  try {
    const bytes = totalmem();
    if (valid(bytes) && bytes > 0) totalMemoryBytes = bytes;
  } catch {
    /* Unknown resources fail admission below. */
  }
  if (process.platform === "linux") {
    try {
      const text = await readFile("/proc/meminfo", "utf8");
      const match = /^MemAvailable:\s+(\d+)\s+kB$/mu.exec(text);
      const bytes = match ? Number(match[1]) * 1024 : NaN;
      if (valid(bytes)) freeMemoryBytes = bytes;
    } catch {
      /* Fall back to the OS measurement when procfs is unavailable. */
    }
  }
  if (freeMemoryBytes === null) {
    try {
      const bytes = freemem();
      if (valid(bytes)) freeMemoryBytes = bytes;
    } catch {
      /* Leave the measurement unknown. */
    }
  }
  return { totalMemoryBytes, freeMemoryBytes };
}

export function assertOfflineEligibility(reason: OfflinePreflight["installationEligibility"]) {
  const codes = {
    "unsupported-platform": "PLATFORM_UNSUPPORTED",
    "resources-unknown": "RESOURCES_UNKNOWN",
    "insufficient-memory": "MEMORY_INSUFFICIENT",
    "insufficient-disk": "DISK_INSUFFICIENT",
  } as const;
  if (reason !== "ready") fail(codes[reason]);
}
