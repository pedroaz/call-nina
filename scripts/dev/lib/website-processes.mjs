import { readFile, readdir, readlink, realpath } from "node:fs/promises";
import path from "node:path";
import { processIdentity, sameProcess } from "./lifecycle.mjs";

// Match the exact checkout and Vite executable, never a port or a process-name substring.
export async function stopWebsite(root) {
  const website = await realpath(path.join(root, "apps/website"));
  let vite;
  try {
    vite = await realpath(path.join(website, "node_modules/vite/bin/vite.js"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    process.stdout.write("website: already-stopped (Vite is not installed)\n");
    return;
  }
  const owned = [];
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (pid <= 1) continue;
    try {
      const identity = await processIdentity(pid);
      if (!identity || identity.uid !== process.getuid() || identity.zombie) continue;
      const cwd = await readlink(`/proc/${pid}/cwd`);
      if (cwd !== website) continue;
      const args = (await readFile(`/proc/${pid}/cmdline`, "utf8")).split("\0");
      if (!args[1] || (await realpath(path.resolve(cwd, args[1]))) !== vite) continue;
      if (args.includes("build")) continue;
      if (sameProcess(identity, await processIdentity(pid))) owned.push(identity);
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EACCES"].includes(error.code)) throw error;
    }
  }
  const live = async () => {
    const remaining = [];
    for (const identity of owned) {
      const observed = await processIdentity(identity.pid);
      if (sameProcess(identity, observed) && !observed.zombie) remaining.push(identity);
    }
    return remaining;
  };
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    for (const identity of await live()) {
      try {
        process.kill(identity.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    const deadline = Date.now() + 3000;
    while ((await live()).length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!(await live()).length) break;
  }
  if ((await live()).length) throw new Error("Website processes did not stop.");
  process.stdout.write(`website: ${owned.length ? "stopped" : "already-stopped"}\n`);
}
