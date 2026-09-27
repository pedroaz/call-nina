#!/bin/sh
set -eu
# Bootstrap only Node; dependency installation and lifecycle live in install.mjs.
command=${1:-install}
case "$command" in install|update|status|uninstall) ;; *) echo 'Usage: install/install.sh install|update|status|uninstall' >&2; exit 2;; esac
root=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
case "$(uname -s):$(uname -m)" in
  Linux:x86_64) platform=linux; arch=x64; base=${XDG_DATA_HOME:-"$HOME/.local/share"}/call-nina/installer ;;
  Darwin:x86_64) platform=darwin; arch=x64; base="$HOME/Library/Application Support/Call Nina Installer" ;;
  Darwin:arm64) platform=darwin; arch=arm64; base="$HOME/Library/Application Support/Call Nina Installer" ;;
  *) echo 'Unsupported platform. Use Linux x64, macOS x64/ARM64, or install.ps1 on Windows x64.' >&2; exit 2 ;;
esac
case "$base" in /*) ;; *) echo 'Installer location must be absolute' >&2; exit 2;; esac
[ "$base" != / ] || exit 2
cursor=$base
while [ "$cursor" != / ]; do
  [ ! -L "$cursor" ] || { echo 'Installer paths cannot traverse symbolic links' >&2; exit 1; }
  cursor=$(dirname -- "$cursor")
done
if command -v node >/dev/null 2>&1 && node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a===26&&b>=5&&!process.versions.node.includes("-")?0:1)' >/dev/null 2>&1; then
  exec node "$root/install/install.mjs" "$command"
fi
# .node-version is the recommended bootstrap version; runtime checks accept its range.
version=$(cat "$root/.node-version" | tr -d '\r\n')
case "$version" in 26.[0-9]*.[0-9]*) ;; *) echo 'Invalid recommended Node version' >&2; exit 2;; esac
node_root="$base/tools/node-v$version-$platform-$arch"
if [ -d "$base/tools" ]; then
  if [ "$platform" = darwin ]; then tool_owner=$(stat -f %u "$base/tools"); tool_mode=$(stat -f %Lp "$base/tools"); else tool_owner=$(stat -c %u "$base/tools"); tool_mode=$(stat -c %a "$base/tools"); fi
  [ "$tool_owner" = "$(id -u)" ] && [ "$((0$tool_mode & 022))" = 0 ] || { echo 'Installer tools directory is not privately owned' >&2; exit 1; }
fi
cursor="$node_root/bin/node"
while [ "$cursor" != "$base" ]; do
  [ ! -L "$cursor" ] || { echo 'Node path cannot traverse symbolic links' >&2; exit 1; }
  cursor=$(dirname -- "$cursor")
done
if [ ! -x "$node_root/bin/node" ]; then
  case "$command" in status|uninstall) echo 'Install a compatible Node 26.5–26.x runtime to run this command.' >&2; exit 1;; esac
  umask 077
  mkdir -p "$base/tools"
  [ ! -L "$base" ] && [ ! -L "$base/tools" ] || exit 1
  scratch=$(mktemp -d "$base/tools/.download-XXXXXX")
  trap 'rm -rf -- "$scratch"' EXIT HUP INT TERM
  archive="node-v$version-$platform-$arch.tar.gz"
  curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v$version/$archive" -o "$scratch/$archive"
  curl --fail --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/v$version/SHASUMS256.txt" -o "$scratch/SHASUMS256.txt"
  expected=$(awk -v file="$archive" '$2 == file { print $1 }' "$scratch/SHASUMS256.txt")
  if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum "$scratch/$archive" | awk '{print $1}'); else actual=$(shasum -a 256 "$scratch/$archive" | awk '{print $1}'); fi
  [ -n "$expected" ] && [ "$expected" = "$actual" ] || { echo 'Node archive checksum mismatch' >&2; exit 1; }
  tar -xzf "$scratch/$archive" -C "$scratch"
  [ ! -e "$node_root" ] || { echo 'Node destination already exists; refusing replacement' >&2; exit 1; }
  mv "$scratch/node-v$version-$platform-$arch" "$node_root"
fi
if [ -n "${scratch:-}" ]; then rm -rf -- "$scratch"; trap - EXIT HUP INT TERM; fi
PATH="$node_root/bin:$PATH"; export PATH
exec "$node_root/bin/node" "$root/install/install.mjs" "$command"
