import { context, github, repository, setOutput, summary } from "./common.mjs";
import { desktopTargets, verify } from "./artifacts.mjs";

export async function resolveSource() {
  context(true);
  return inspectSource(process.env.RELEASE_BUILD_RUN_ID, process.env.GITHUB_SHA);
}

// Read-only inspection also supports diagnosing source eligibility outside Actions.
export async function inspectSource(runId, publicationCommit) {
  if (!/^[1-9]\d*$/.test(runId ?? "")) throw new Error("Enter a numeric Build run ID");
  if (!/^[a-f0-9]{40}$/.test(publicationCommit ?? ""))
    throw new Error("Invalid publication commit");
  const build = await github(`actions/runs/${runId}`);
  if (
    build.repository?.full_name !== repository ||
    build.head_repository?.full_name !== repository ||
    build.event !== "workflow_dispatch" ||
    build.head_branch !== "main" ||
    build.status !== "completed" ||
    build.conclusion !== "success" ||
    ![".github/workflows/build.yml", ".github/workflows/release.yml"].includes(build.path) ||
    !/^[a-f0-9]{40}$/.test(build.head_sha ?? "")
  )
    throw new Error(
      "Source must be a successful manual Build or Release run from this repository's main branch",
    );
  const comparison = await github(`compare/${build.head_sha}...${publicationCommit}`);
  if (!["ahead", "identical"].includes(comparison.status))
    throw new Error("Build commit is not an ancestor of the selected main commit");
  const sourcePackage = await github(`contents/package.json?ref=${build.head_sha}`);
  const { version } = JSON.parse(Buffer.from(sourcePackage.content, "base64").toString("utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) throw new Error("Invalid build version");
  const artifacts = [];
  for (let page = 1; ; page++) {
    const batch = await github(`actions/runs/${runId}/artifacts?per_page=100&page=${page}`);
    artifacts.push(...batch.artifacts);
    if (batch.artifacts.length < 100) break;
  }
  const expected = desktopTargets.map((id) => `desktop-${id}`);
  const selectedArtifacts = artifacts.filter((item) => expected.includes(item.name));
  if (
    selectedArtifacts.length !== expected.length ||
    expected.some((name) => selectedArtifacts.filter((item) => item.name === name).length !== 1) ||
    selectedArtifacts.some(
      (item) =>
        item.expired ||
        Date.parse(item.expires_at) <= Date.now() ||
        item.workflow_run?.head_sha !== build.head_sha ||
        String(item.workflow_run?.id) !== runId,
    )
  )
    throw new Error(
      "Build requires all four desktop artifacts, unexpired and from the same commit",
    );
  const ids = selectedArtifacts
    .map((item) => item.id)
    .sort((a, b) => a - b)
    .join(",");
  return { commit: build.head_sha, version, artifacts: ids, runId };
}

export async function source() {
  const selected = await resolveSource();
  for (const key of ["commit", "version", "artifacts"]) await setOutput(key, selected[key]);
  await summary(
    `Publish source: https://github.com/${repository}/actions/runs/${selected.runId}\nCommit: ${selected.commit}\nVersion: ${selected.version}\nAll four desktop artifacts are available. Publication will not rebuild them.`,
  );
}

export async function verifySource() {
  // Recheck after the environment gate and download: artifacts may expire or be replaced.
  const selected = await resolveSource();
  if (
    selected.commit !== process.env.RELEASE_SOURCE_COMMIT ||
    selected.version !== process.env.RELEASE_SOURCE_VERSION ||
    selected.artifacts !== process.env.RELEASE_SOURCE_ARTIFACTS
  )
    throw new Error("Build identity changed after source selection");
  for (const id of desktopTargets) await verify(id);
  await summary(
    "All source manifests, versions, targets and SHA-256 checksums verified before publication.",
  );
}
