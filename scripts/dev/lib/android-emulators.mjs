import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function findAdb() {
  const executable = process.platform === "win32" ? "adb.exe" : "adb";
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Android", "sdk")
      : process.platform === "win32"
        ? process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk")
        : path.join(os.homedir(), "Android", "Sdk"),
  ];
  for (const root of roots.filter(Boolean)) {
    const candidate = path.join(root, "platform-tools", executable);
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next SDK location, then PATH.
    }
  }
  return executable;
}

export async function stopAndroidEmulators() {
  const adb = await findAdb();
  const run = (...args) => execute(adb, args, { timeout: 10_000 });
  const devices = async () => {
    const { stdout } = await run("devices");
    return stdout.split(/\r?\n/).flatMap((line) => {
      const match = /^(emulator-\d+)\s+(\S+)/.exec(line);
      return match ? [{ serial: match[1], state: match[2] }] : [];
    });
  };
  let targets;
  try {
    targets = await devices();
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Android emulator discovery failed.");
    process.stdout.write("android: skipped (ADB not installed)\n");
    return;
  }
  if (!targets.length) {
    process.stdout.write("android: already-stopped\n");
    return;
  }
  for (const { serial, state } of targets) {
    try {
      if (state !== "device") throw new Error("Emulator is not online");
      try {
        await run("-s", serial, "emu", "kill");
      } catch {
        // The console may disconnect while the emulator is shutting down.
        // Confirm disappearance before reporting success or failure.
      }
      const deadline = Date.now() + 30_000;
      while ((await devices()).some((device) => device.serial === serial)) {
        if (Date.now() >= deadline) throw new Error("Emulator shutdown timed out");
        await pause(250);
      }
      process.stdout.write(`android ${serial}: stopped\n`);
    } catch {
      process.stderr.write(`android ${serial}: shutdown failed; inspect adb devices\n`);
      process.exitCode = 1;
    }
  }
}
