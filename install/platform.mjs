import { execFileSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, readlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertNoLinks } from "../packages/platform/src/index.ts";

export const platform = process.platform;
const home = os.homedir();
const data = process.env.XDG_DATA_HOME || path.join(home, ".local/share");
const local = process.env.LOCALAPPDATA || path.join(home, "AppData/Local");
export const configRoot =
  platform === "darwin"
    ? path.join(home, "Library/Application Support/Call Nina")
    : platform === "win32"
      ? path.join(process.env.APPDATA || path.join(home, "AppData/Roaming"), "Call Nina")
      : path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "Call Nina");
export const installerRoot =
  platform === "darwin"
    ? path.join(home, "Library/Application Support/Call Nina Installer")
    : platform === "win32"
      ? path.join(local, "Call Nina Installer")
      : path.join(data, "call-nina/installer");
export const appRoot =
  platform === "darwin"
    ? path.join(home, "Applications/Call Nina.app")
    : platform === "win32"
      ? path.join(local, "Programs/Call Nina")
      : path.join(data, "call-nina/app");
export const executable = path.join(
  appRoot,
  platform === "darwin"
    ? "Contents/MacOS/Call Nina"
    : platform === "win32"
      ? "call-nina.exe"
      : "call-nina",
);
export const resources = path.join(
  appRoot,
  platform === "darwin" ? "Contents/Resources" : "resources",
);
export const bootstrapFile = path.join(configRoot, "bootstrap.json");

export function powershell(script, env = {}) {
  return execFileSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; " + script],
    { encoding: "utf8", windowsHide: true, env: { ...process.env, ...env }, timeout: 20_000 },
  );
}
export async function exists(filename) {
  return lstat(filename).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );
}
export function inside(root, filename) {
  const rel = path.relative(root, filename);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}
export async function running(roots) {
  if (platform === "linux") {
    for (const pid of await readdir("/proc")) {
      if (!/^\d+$/.test(pid)) continue;
      const exe = await readlink(`/proc/${pid}/exe`).catch(() => "");
      if (roots.some((root) => inside(root, exe.replace(/ \(deleted\)$/, "")))) return true;
      // Development Node helpers can reference a retained staged payload.
      const argv = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
      if (
        argv
          .split("\0")
          .some((arg) => path.isAbsolute(arg) && roots.some((root) => inside(root, arg)))
      )
        return true;
    }
    return false;
  }
  if (platform === "win32") {
    const rows = JSON.parse(
      powershell(
        "Get-CimInstance Win32_Process | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress",
      ) || "[]",
    );
    return [rows]
      .flat()
      .some((row) =>
        roots.some(
          (root) =>
            (row.ExecutablePath && inside(root, row.ExecutablePath)) ||
            row.CommandLine?.includes(root),
        ),
      );
  }
  const commands = execFileSync("/bin/ps", ["-axo", "command="], { encoding: "utf8" });
  return commands
    .split("\n")
    .some((command) => roots.some((root) => command.includes(root + path.sep)));
}

const desktopFile = path.join(data, "applications/dev.callnina.app.desktop");
const shortcut = path.join(
  process.env.APPDATA || configRoot,
  "Microsoft/Windows/Start Menu/Programs/Call Nina.lnk",
);
const registryKey = "HKCU:\\Software\\Classes\\call-nina";
function desktopQuote(value) {
  return '"' + value.replace(/[\\"`$]/g, "\\$&").replaceAll("%", "%%") + '"';
}

export async function registerLaunchers(previous) {
  if (platform === "linux") {
    const content = `[Desktop Entry]\nType=Application\nName=Call Nina\nExec=${desktopQuote(executable)} %u\nIcon=${path.join(resources, "call-nina.png")}\nTerminal=false\nCategories=Education;\nMimeType=x-scheme-handler/call-nina;\n`;
    await assertNoLinks(desktopFile);
    if (await exists(desktopFile)) {
      const old = await readFile(desktopFile, "utf8");
      if (!old.includes(`Exec=${desktopQuote(executable)} %u\n`))
        throw new Error("LAUNCHER_NOT_OWNED");
    }
    const config = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
    await assertNoLinks(config);
    await mkdir(config, { recursive: true, mode: 0o700 });
    const query = () =>
      execFileSync("xdg-mime", ["query", "default", "x-scheme-handler/call-nina"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
    const currentDefault = query();
    const receipt = {
      kind: "linux",
      file: desktopFile,
      content,
      previousDefault:
        currentDefault === "dev.callnina.app.desktop"
          ? previous?.previousDefault || ""
          : currentDefault,
    };
    await mkdir(path.dirname(desktopFile), { recursive: true });
    await writeFile(desktopFile, content);
    try {
      execFileSync("xdg-mime", [
        "default",
        "dev.callnina.app.desktop",
        "x-scheme-handler/call-nina",
      ]);
      if (query() !== "dev.callnina.app.desktop") throw new Error("PROTOCOL_REGISTRATION_FAILED");
    } catch (error) {
      error.registration = receipt;
      throw error;
    }
    return receipt;
  }

  if (platform === "darwin") {
    execFileSync(
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
      ["-f", appRoot],
    );
    return { kind: "darwin" };
  }
  powershell(
    `
$w = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $env:OD_SHORTCUT) { if ($w.CreateShortcut($env:OD_SHORTCUT).TargetPath -ne $env:OD_EXECUTABLE) { throw 'LAUNCHER_NOT_OWNED' } }
$key = $env:OD_REGISTRY
if (Test-Path ($key + '\\shell\\open\\command')) { if ((Get-Item ($key + '\\shell\\open\\command')).GetValue('') -ne ('"' + $env:OD_EXECUTABLE + '" "%1"')) { throw 'PROTOCOL_NOT_OWNED' } }
New-Item -ItemType Directory -Force -Path (Split-Path $env:OD_SHORTCUT) | Out-Null
$s = $w.CreateShortcut($env:OD_SHORTCUT); $s.TargetPath=$env:OD_EXECUTABLE; $s.WorkingDirectory=Split-Path $env:OD_EXECUTABLE; $s.Save()
New-Item ($key + '\\shell\\open\\command') -Force | Out-Null
Set-Item $key 'URL:Call Nina'
New-ItemProperty $key -Name 'URL Protocol' -Value '' -Force | Out-Null
Set-Item ($key + '\\shell\\open\\command') ('"' + $env:OD_EXECUTABLE + '" "%1"')
`,
    { OD_SHORTCUT: shortcut, OD_EXECUTABLE: executable, OD_REGISTRY: registryKey },
  );
  return { kind: "win32", file: shortcut };
}

export async function unregisterLaunchers(registration) {
  if (!registration) return;
  if (platform === "linux") {
    if (registration.file !== desktopFile) throw new Error("LAUNCHER_PATH_INVALID");
    await assertNoLinks(desktopFile);
    if (await exists(desktopFile)) {
      if ((await readFile(desktopFile, "utf8")) !== registration.content) {
        console.log("Preserved a changed desktop launcher and its registration.");
        return;
      }
      await unlink(desktopFile);
    }
    // Remove only our scheme mapping; preserve every unrelated mimeapps entry.
    const mimeFiles = [
      path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "mimeapps.list"),
      path.join(data, "applications/mimeapps.list"),
    ];
    for (const file of mimeFiles) {
      if (!(await exists(file))) continue;
      await assertNoLinks(file);
      const old = await readFile(file, "utf8");
      const next = old.replace(/^x-scheme-handler\/call-nina=(.*)$/gm, (line, value) => {
        const values = value.split(";").filter((v) => v && v !== "dev.callnina.app.desktop");
        if (
          !values.length &&
          registration.previousDefault &&
          /^[A-Za-z0-9_.-]+\.desktop$/.test(registration.previousDefault)
        )
          values.push(registration.previousDefault);
        return values.length ? `x-scheme-handler/call-nina=${values.join(";")};` : "";
      });
      if (old !== next) await writeFile(file, next);
    }
  } else if (platform === "darwin") {
    execFileSync(
      "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister",
      ["-u", appRoot],
    );
  } else {
    if (registration.file !== shortcut) throw new Error("LAUNCHER_PATH_INVALID");
    powershell(
      `
$w = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $env:OD_SHORTCUT) { if ($w.CreateShortcut($env:OD_SHORTCUT).TargetPath -eq $env:OD_EXECUTABLE) { Remove-Item -LiteralPath $env:OD_SHORTCUT } }
$key=$env:OD_REGISTRY
if (Test-Path ($key + '\\shell\\open\\command')) { if ((Get-Item ($key + '\\shell\\open\\command')).GetValue('') -eq ('"' + $env:OD_EXECUTABLE + '" "%1"')) { Remove-Item $key -Recurse } }
`,
      { OD_SHORTCUT: shortcut, OD_EXECUTABLE: executable, OD_REGISTRY: registryKey },
    );
  }
}

export async function registrationStatus(registration) {
  if (!registration) return "missing";
  if (platform === "linux") {
    if (
      !(await exists(desktopFile)) ||
      (await readFile(desktopFile, "utf8")) !== registration.content
    )
      return "launcher-missing-or-changed";
    try {
      const current = execFileSync("xdg-mime", ["query", "default", "x-scheme-handler/call-nina"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      return current === "dev.callnina.app.desktop" ? "ready" : "protocol-not-associated";
    } catch {
      return "protocol-check-unavailable";
    }
  }
  if (platform === "win32") {
    try {
      return powershell(
        `
$w=New-Object -ComObject WScript.Shell
$command=(Get-Item ($env:OD_REGISTRY + '\\shell\\open\\command')).GetValue('')
if ((Test-Path -LiteralPath $env:OD_SHORTCUT) -and $w.CreateShortcut($env:OD_SHORTCUT).TargetPath -eq $env:OD_EXECUTABLE -and $command -eq ('"' + $env:OD_EXECUTABLE + '" "%1"')) { 'ready' } else { 'launcher-or-protocol-changed' }
`,
        { OD_SHORTCUT: shortcut, OD_EXECUTABLE: executable, OD_REGISTRY: registryKey },
      ).trim();
    } catch {
      return "launcher-or-protocol-unavailable";
    }
  }
  return (await exists(path.join(appRoot, "Contents/Info.plist")))
    ? "bundle-present-native-link-check-required"
    : "bundle-missing";
}
