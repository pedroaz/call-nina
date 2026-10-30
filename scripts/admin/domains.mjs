import { config, infrastructure, output, ControlError } from "./configuration.mjs";
import { vercel, project } from "./providers.mjs";
import { confirm } from "./review.mjs";

export async function setupDomains(yes) {
  await project();
  const apex = new URL(infrastructure.production.origin).hostname;
  const staging = new URL(infrastructure.preview.origin).hostname;
  const desired = [
    { name: apex, gitBranch: null, redirect: null },
    { name: `www.${apex}`, gitBranch: null, redirect: apex, redirectStatusCode: 308 },
    { name: staging, gitBranch: "staging", redirect: null },
  ];
  const { domains } = await vercel(`/v9/projects/${config.projectId}/domains`);
  const changes = desired.filter((entry) => {
    const current = domains.find((domain) => domain.name === entry.name);
    return (
      !current || Object.entries(entry).some(([key, value]) => (current[key] ?? null) !== value)
    );
  });
  await confirm(
    {
      operation: "infra domains-setup",
      projectId: config.projectId,
      changes,
      registrar: "Squarespace (unchanged)",
    },
    yes,
  );
  for (const entry of changes) {
    const exists = domains.some((domain) => domain.name === entry.name);
    const result = await vercel(
      `/v10/projects/${config.projectId}/domains${exists ? `/${entry.name}` : ""}`,
      exists ? "PATCH" : "POST",
      entry,
    );
    if (result.name !== entry.name || result.projectId !== config.projectId)
      throw new ControlError("Domain assignment readback failed; inspect before retrying");
    output({
      domain: result.name,
      verified: result.verified,
      verification: result.verification ?? [],
    });
  }
  for (const entry of desired) {
    const result = await vercel(`/v6/domains/${entry.name}/config`);
    output({
      domain: entry.name,
      misconfigured: result.misconfigured,
      recommendedIPv4: result.recommendedIPv4,
      recommendedCNAME: result.recommendedCNAME,
    });
  }
}
