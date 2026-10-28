const desktopBuilds = [
  { runner: "ubuntu-24.04", platform: "linux-x64", input: "build_linux" },
  { runner: "windows-2022", platform: "win32-x64", input: "build_windows" },
  { runner: "macos-15-intel", platform: "darwin-x64", input: "build_macos_intel" },
  { runner: "macos-15", platform: "darwin-arm64", input: "build_macos_arm" },
];

export const desktopTargets = desktopBuilds.map(({ platform }) => platform);

export function selectDesktopBuilds(target, inputs) {
  const selected = desktopBuilds.filter(({ input }) => {
    if (target === "hosting") return false;
    if (typeof inputs[input] !== "boolean") throw new Error(`Missing build selection: ${input}`);
    return inputs[input];
  });
  if (target === "desktop" && selected.length === 0)
    throw new Error("Select at least one desktop platform for a desktop build");
  return selected.map(({ runner, platform }) => ({ runner, platform }));
}
