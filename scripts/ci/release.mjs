import { context, help, node, readJson, setOutput, summary, workflowUrl } from "./common.mjs";

async function preflight() {
  const current = context();
  const target = process.env.RELEASE_TARGET;
  const operation = process.env.RELEASE_OPERATION;
  if (
    !["desktop", "hosting", "all"].includes(target) ||
    !["build-only", "publish"].includes(operation)
  )
    throw new Error("Invalid release inputs");
  if (operation === "publish") context(true);
  const { version } = await readJson("package.json");
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("Desktop release requires a stable numeric version");
  node("scripts/diagnostics/check-toolchain.mjs");
  node("scripts/diagnostics/check-versions.mjs");
  if (target !== "desktop")
    await (await import("../admin/configuration.mjs")).checkPublicConfiguration();
  if (operation === "publish") await (await import("./desktop-release.mjs")).inspectRelease();
  await setOutput("sha", current.commit);
  await summary(
    `Release preflight: **${target} / ${operation}**\nCommit: ${current.commit}\nVersion: ${version}\nRun: https://github.com/${current.repository}/actions/runs/${current.runId}`,
  );
}
async function report() {
  const jobs = JSON.parse(process.env.RELEASE_RESULTS ?? "{}");
  await summary(
    `## Release result\n\nCommit: ${process.env.GITHUB_SHA}\n\n| Job | Result |\n| --- | --- |\n${Object.entries(
      jobs,
    )
      .map(([name, job]) => `| ${name} | ${job.result} |`)
      .join(
        "\n",
      )}\n\nDownloads are in this run's Artifacts section (30-day retention). Published desktop assets remain on GitHub Releases.\n\n${workflowUrl}`,
  );
  if (jobs.deploy?.result === "success" && ["failure", "cancelled"].includes(jobs.publish?.result))
    await summary(
      "Hosting succeeded but desktop publication failed. Inspect the deployment and retained draft before retrying; no automatic rollback occurred.",
    );
}
try {
  const action = process.argv[2] ?? "help";
  if (process.argv.length > 3) throw new Error("Unexpected release arguments");
  switch (action) {
    case "help":
      help();
      break;
    case "preflight":
      await preflight();
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
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}
