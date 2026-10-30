import { openRepositoryFolder } from "./lib/open-folder.mjs";
import { spawnSync } from "node:child_process";
import { childEnvironment } from "./lib/environment.mjs";
import { pnpmCommand } from "./lib/package-command.mjs";
import { runStage } from "./lib/run-stage.mjs";
const root = new URL("../", import.meta.url);
function run(command, args, environment = childEnvironment()) {
  const child = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: environment,
  });
  if (child.error) throw new Error(`Cannot start ${command}`);
  if (child.status !== 0)
    throw Object.assign(new Error("Command failed"), { exitCode: child.status ?? 1 });
}
const node = (file, ...args) => run(process.execPath, [file, ...args]);
// Only the admin entrypoint may receive operator environment overrides.
const admin = (...args) => run(process.execPath, ["scripts/admin/index.mjs", ...args], process.env);
const pnpm = (...args) => run(...pnpmCommand(args));
const build = (surface) =>
  surface === "workspace"
    ? pnpm("--recursive", "--workspace-concurrency=1", "--if-present", "run", "build")
    : pnpm("--filter", `@call-nina/${surface}...`, "run", "build");
const leaf = (description, execute) => ({ description, execute });
const group = (description, commands, defaultCommand) => ({
  description,
  commands,
  defaultCommand,
});
const verifyNames = [
  "start",
  "resume",
  "status",
  "snapshot",
  "screenshot",
  "do",
  "stop",
  "suspend",
  "manual-status",
  "manual-enter",
  "manual-leave",
  "manual-recover",
  "manual-quarantine",
];
const checks = {
  versions: leaf("Workspace version consistency", () =>
    node("scripts/diagnostics/check-versions.mjs"),
  ),
  "design-tokens": leaf("Generated design tokens", () =>
    node("scripts/build/generate-design-tokens.mjs", "--check"),
  ),
  format: leaf("Source formatting", () => pnpm("exec", "prettier", "--check", ".")),
  lint: leaf("Source lint", () => pnpm("exec", "eslint", ".", "--max-warnings=0")),
  types: leaf("Workspace TypeScript", () => pnpm("exec", "tsc", "-b")),
  toolchain: leaf("Node and pnpm toolchain", () => node("scripts/diagnostics/check-toolchain.mjs")),
  integration: leaf("Toolchain including Codex", () =>
    node("scripts/diagnostics/check-toolchain.mjs", "--require-codex"),
  ),
  mobile: leaf("Expo dependency consistency", () =>
    pnpm("--filter", "@call-nina/mobile", "run", "check:dependencies"),
  ),
};
const aliases = { h: "help", d: "dev", b: "build", l: "logs" };
const registry = {
  speech: group("Local speech bundles (no synthesis or publishing)", {
    prepare: leaf("Prepare pinned CPU runtimes and voices", (args) => {
      pnpm(
        "--filter",
        "@call-nina/speech-runtime...",
        "--filter",
        "@call-nina/persistence...",
        "run",
        "build",
      );
      node("scripts/speech/bundles.mjs", "prepare", ...args);
    }),
    status: leaf("Validate and inspect local bundles", () => {
      pnpm(
        "--filter",
        "@call-nina/speech-runtime...",
        "--filter",
        "@call-nina/persistence...",
        "run",
        "build",
      );
      node("scripts/speech/bundles.mjs", "status");
    }),
  }),
  help: leaf("Show commands and shortcuts", (args) => help(args[0])),
  folder: leaf("Open the repository folder", openRepositoryFolder),
  release: leaf("Manual GitHub release workflow", () => node("scripts/ci/release.mjs", "help")),
  deploy: group(
    "Hosting build/review and GitHub publication guidance",
    {
      prepare: leaf("Build combined website/API locally; no upload", () =>
        node("scripts/build/package-hosting.mjs"),
      ),
      review: leaf("Review the production deployment target; no upload", () => admin("deploy")),
      production: leaf("Open manual GitHub publication instructions; no local upload", () =>
        node("scripts/ci/release.mjs", "help"),
      ),
    },
    "review",
  ),
  setup: group(
    "Install workspace dependencies",
    Object.fromEntries(
      ["dev", "build"].map((profile) => [
        profile,
        leaf(`${profile} dependencies`, () =>
          node("scripts/build/setup.mjs", "--profile", profile),
        ),
      ]),
    ),
    "dev",
  ),
  ...Object.fromEntries(
    ["dev", "start", "stop", "kill", "status", "logs"].map((name) => [
      name,
      leaf(
        {
          dev: "Build and start desktop development",
          start: "Start built desktop",
          stop: "Stop desktop and watchers",
          kill: "Stop desktop, watchers and local Android emulators",
          status: "Desktop process status",
          logs: "Desktop logs; --follow / --errors / --clear",
        }[name],
        (args) =>
          node(
            "scripts/dev/lifecycle.mjs",
            ...({ dev: ["start", "dev"], start: ["start", "prd"] }[name] ?? [name]),
            ...args,
          ),
      ),
    ]),
  ),
  build: group(
    "Build desktop or a selected surface",
    Object.fromEntries(
      ["desktop", "website", "mobile", "api", "workspace"].map((surface) => [
        surface,
        leaf(`Build ${surface}`, () => build(surface)),
      ]),
    ),
    "desktop",
  ),
  website: group(
    "Website development",
    Object.fromEntries(
      ["dev", "build", "preview"].map((action) => [
        action,
        leaf(action, (args) =>
          action === "build"
            ? build("website")
            : pnpm("--filter", "@call-nina/website", "run", action, ...args),
        ),
      ]),
    ),
  ),
  mobile: group(
    "Mobile development",
    Object.fromEntries(
      ["dev", "build", "config", "android", "ios"].map((action) => [
        action,
        leaf(action, (args) => pnpm("--filter", "@call-nina/mobile", "run", action, ...args)),
      ]),
    ),
  ),
  check: group(
    "Static checks",
    {
      all: leaf("All static checks", () => {
        for (const name of ["versions", "design-tokens", "format", "types", "lint"])
          runStage(checks[name].description, () => checks[name].execute());
      }),
      ...checks,
    },
    "all",
  ),
  format: group(
    "Format repository source",
    {
      write: leaf("Format source", () => pnpm("exec", "prettier", "--write", ".")),
      check: checks.format,
      lint: leaf("Apply lint fixes", () =>
        pnpm("exec", "eslint", ".", "--fix", "--max-warnings=0"),
      ),
    },
    "write",
  ),
  clean: leaf("Remove generated output only", () => node("scripts/build/clean.mjs")),
  verify: group(
    "Owned interactive desktop verification",
    Object.fromEntries(
      verifyNames.map((name) => [
        name,
        leaf(name, (args) => node("scripts/dev/verify.mjs", name, ...args)),
      ]),
    ),
  ),
  package: group("Build local distribution artifacts", {
    local: leaf("Unpacked desktop for this platform", () =>
      node("scripts/build/package-local.mjs"),
    ),
    appimage: leaf("Linux AppImage", () => {
      runStage("Generate third-party notices", () =>
        node("scripts/build/generate-third-party-notices.mjs"),
      );
      runStage("Build desktop and MCP server", () => build("desktop"));
      runStage("Stage MCP helper", () =>
        node("scripts/build/build-mcp-helper.mjs", "--skip-build"),
      );
      runStage("Package AppImage", () =>
        pnpm("--filter", "@call-nina/desktop", "run", "package:appimage"),
      );
      runStage("Inspect AppImage resources and size", () =>
        node("scripts/build/inspect-package.mjs", "appimage"),
      );
    }),
    hosting: leaf("Combined website and API", () => node("scripts/build/package-hosting.mjs")),
    inspect: leaf("Inspect packaging budgets", (args) =>
      node("scripts/build/inspect-package.mjs", ...args),
    ),
  }),
  install: group(
    "Per-user installation",
    Object.fromEntries(
      ["install", "update", "status", "uninstall"].map((action) => [
        action,
        leaf(action, (args) => run("sh", ["install/install.sh", action, ...args])),
      ]),
    ),
  ),
  plugin: group(
    "Local Codex plugin",
    Object.fromEntries(
      ["install", "refresh", "status", "uninstall"].map((action) => [
        action,
        leaf(action, () => {
          if (action !== "status")
            node("scripts/diagnostics/check-toolchain.mjs", "--require-codex");
          pnpm("--filter", "@call-nina/plugin", "run", `plugin:${action}`);
        }),
      ]),
    ),
  ),
  generate: group("Regenerate owned source artifacts", {
    "design-tokens": leaf("Browser design tokens and font notices", () =>
      node("scripts/build/generate-design-tokens.mjs"),
    ),
    "third-party-notices": leaf("Dependency license notices", () =>
      node("scripts/build/generate-third-party-notices.mjs"),
    ),
  }),
  doctor: leaf("Development diagnostics", (args) =>
    node("scripts/diagnostics/doctor.mjs", ...args),
  ),
};
function help(name) {
  name = aliases[name] ?? name;
  const entries = name ? registry[name]?.commands : registry;
  if (!entries) throw new Error(`Unknown command group: ${name}`);
  process.stdout.write(
    name ? `Usage: make ${name} COMMAND ...\n` : "Usage: make COMMAND [SUBCOMMAND ...]\n",
  );
  const sections = name
    ? { Commands: Object.keys(entries) }
    : {
        "Daily desktop": ["dev", "start", "stop", "kill", "status", "logs", "folder"],
        Development: [
          "setup",
          "build",
          "website",
          "mobile",
          "check",
          "format",
          "clean",
          "verify",
          "doctor",
        ],
        "Distribution and tooling": [
          "release",
          "package",
          "deploy",
          "install",
          "plugin",
          "generate",
          "help",
        ],
      };
  for (const [title, keys] of Object.entries(sections)) {
    if (!name) process.stdout.write(`\n${title}\n`);
    for (const key of keys) {
      const shortcuts = name ? [] : Object.keys(aliases).filter((alias) => aliases[alias] === key);
      const label = [key, ...shortcuts].join(", ");
      process.stdout.write(`  ${label.padEnd(20)} ${entries[key].description}\n`);
    }
  }
  process.stdout.write(
    "\nNavigation: make help [GROUP] for details; make folder opens the repository folder.\n",
  );
  if (!name)
    process.stdout.write(
      "\nExamples: make dev; make verify manual-status; make package hosting; make logs -- --errors\n",
    );
}
try {
  const [requested = "help", ...args] = process.argv.slice(2);
  const name = aliases[requested] ?? requested;
  if (name === "help") help(args[0]);
  else {
    const entry = registry[name];
    if (!entry) throw new Error("Unknown command; run make help");
    if (entry.commands) {
      if (args[0] === "help" || args[0] === "--help" || (!args.length && !entry.defaultCommand))
        help(name);
      else {
        const command = args.shift() ?? entry.defaultCommand;
        if (!entry.commands[command])
          throw new Error(`Unknown ${name} command; run make ${name} help`);
        if (args.length && entry.commands[command].execute.length === 0)
          throw new Error(`Unexpected arguments for ${name} ${command}`);
        entry.commands[command].execute(args);
      }
    } else {
      if (args.length && entry.execute.length === 0)
        throw new Error(`Unexpected arguments for ${name}`);
      entry.execute(args);
    }
  }
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = error.exitCode ?? 1;
}
