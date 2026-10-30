import { writeFile } from "node:fs/promises";
import { api } from "./providers.mjs";
import { config, infrastructure, here, output, ControlError } from "./configuration.mjs";
import { confirm } from "./review.mjs";

export async function setupProject(yes) {
  const team = await api("https://api.vercel.com", `/v2/teams/${config.teamSlug}`, "VERCEL_TOKEN");
  if (team.slug !== config.teamSlug) throw new ControlError("Vercel team identity mismatch");
  const query = `?teamId=${encodeURIComponent(team.id)}`;
  const list = await api(
    "https://api.vercel.com",
    `/v10/projects${query}&search=${encodeURIComponent(config.projectName)}`,
    "VERCEL_TOKEN",
  );
  const existing = list.projects.filter((project) => project.name === config.projectName);
  if (existing.length > 1 || (config.projectId && existing[0]?.id !== config.projectId))
    throw new ControlError("Project identity changed; inspect before creating or relinking");
  if (existing[0]?.link)
    throw new ControlError("Disconnect Git-triggered deployment before using this project");
  await confirm(
    {
      operation: "infra project-setup",
      teamId: team.id,
      teamSlug: team.slug,
      plan: team.billing?.plan,
      projectName: config.projectName,
      action: existing.length ? "link existing project" : "create combined website/API project",
      region: "fra1",
      gitConnection: "none",
    },
    yes,
  );
  const project =
    existing[0] ??
    (await api("https://api.vercel.com", `/v11/projects${query}`, "VERCEL_TOKEN", "POST", {
      name: config.projectName,
      framework: null,
      skipGitConnectDuringLink: true,
      resourceConfig: { functionDefaultRegions: ["fra1"] },
    }));
  if (project.name !== config.projectName || project.accountId !== team.id)
    throw new ControlError("Created project identity mismatch; inspect before retrying");
  for (const profile of Object.values(infrastructure)) {
    if (profile.teamSlug !== team.slug || profile.projectName !== project.name)
      throw new ControlError("Preview and production must select the same Vercel project");
    profile.teamId = team.id;
    profile.projectId = project.id;
  }
  await writeFile(
    new URL("infrastructure.json", here),
    JSON.stringify(infrastructure, null, 2) + "\n",
  );
  output({ projectId: project.id, teamId: team.id, created: !existing.length, deployed: false });
}
