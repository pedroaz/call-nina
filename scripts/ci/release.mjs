import {
  context,
  help,
  node,
  readJson,
  setOutput,
  summary,
  workflowUrl,
  progress,
  diagnostic,
} from "./common.mjs";
import { selectDesktopBuilds } from "./targets.mjs";

async function preflight() {
  const current = context();
  const target = process.env.RELEASE_TARGET;
  const operation = process.env.RELEASE_OPERATION;
  if (!["desktop", "hosting", "all"].includes(target) || operation !== "build-only")
    throw new Error("Invalid release inputs");
  const desktop = selectDesktopBuilds(target, JSON.parse(process.env.RELEASE_INPUTS ?? "{}"));
  const { version } = await readJson("package.json");
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Desktop release requires a stable numeric version");
  node("scripts/diagnostics/check-toolchain.mjs");
  node("scripts/diagnostics/check-versions.mjs");
  if (target !== "desktop")
    await (await import("../admin/configuration.mjs")).checkPublicConfiguration();
  await setOutput("sha", current.commit);
  await setOutput("desktop_matrix", JSON.stringify({ include: desktop }));
  await setOutput("has_desktop", String(desktop.length > 0));
  await summary(
    `Build preflight: **${target}**\nDesktop builds: ${desktop.map(({ platform }) => platform).join(", ") || "none"}\nHosting build: ${target !== "desktop" ? "yes" : "no"}\nCommit: ${current.commit}\nVersion: ${version}\nRun: https://github.com/${current.repository}/actions/runs/${current.runId}`,
  );
}
async function report() {
  const jobs = JSON.parse(process.env.RELEASE_RESULTS ?? "{}");
  await summary(
    `## Release result\n\nCommit: ${context().commit}\nSource run: ${context().runId}\n\n| Stage | Result |\n| --- | --- |\n${Object.entries(
      jobs,
    )
      .map(([name, job]) => `| ${name} | ${job.result ?? job.conclusion} |`)
      .join(
        "\n",
      )}\n\nDownloads are in the source build's Artifacts section (30-day retention). Published desktop assets remain on GitHub Releases.\n\n${workflowUrl}`,
  );
}
const action = process.argv[2] ?? "help";
const started = Date.now();
try {
  if (action !== "help") progress(`Command ${action}: started`);
  if (process.argv.length > 3) throw new Error("Unexpected release arguments");
  switch (action) {
    case "help":
      help();
      break;
    case "preflight":
      await preflight();
      break;
    case "source":
      await (await import("./promotion.mjs")).source();
      break;
    case "verify-source":
      await (await import("./promotion.mjs")).verifySource();
      break;
    case "desktop":
      await (await import("./artifacts.mjs")).desktop();
      break;
    case "hosting":
      await (await import("./artifacts.mjs")).hosting();
      break;
    case "prepare":
      await (await import("./desktop-release.mjs")).prepare();
      break;
    case "publish":
      await (await import("./desktop-release.mjs")).publish();
      break;
    case "deploy":
      await (await import("./hosting-deploy.mjs")).deploy();
      break;
    case "summary":
      await report();
      break;
    default:
      throw new Error("Unknown release command");
  }
  if (action !== "help") progress(`Command ${action}: completed in ${Date.now() - started}ms`);
} catch (error) {
  process.stderr.write(
    `[release] Command ${diagnostic(action)} failed after ${Date.now() - started}ms: ${diagnostic(error.message)}\n`,
  );
  process.exitCode = 1;
}
