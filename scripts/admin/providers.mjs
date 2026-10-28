import { ControlError, config } from "./configuration.mjs";
import { need } from "./credentials.mjs";
export async function api(base, path, key, method = "GET", body, extraHeaders = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      authorization: `Bearer ${need(key)}`,
      "content-type": "application/json",
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new ControlError(
      `Remote ${method} failed (${response.status}); no automatic mutation retry`,
    );
  return response.status === 204 ? null : response.json();
}
export const clerk = (path, method, body, headers) =>
  api("https://api.clerk.com/v1", path, "CLERK_SECRET_KEY", method, body, headers);
export const vercel = (path, method, body) => {
  if (!/^team_[a-zA-Z0-9]+$/.test(config.teamId ?? ""))
    throw new ControlError("Set the selected teamId in infrastructure.json");
  return api(
    "https://api.vercel.com",
    `${path}${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(config.teamId)}`,
    "VERCEL_TOKEN",
    method,
    body,
  );
};
export async function identity(expectedId = config.clerkInstanceId) {
  const instance = await clerk("/instance");
  if (instance.id !== expectedId)
    throw new ControlError("Clerk key belongs to a different instance");
  return instance;
}
export async function project() {
  const project = await vercel(`/v9/projects/${config.projectId}`);
  if (
    project.id !== config.projectId ||
    project.name !== config.projectName ||
    project.accountId !== config.teamId
  )
    throw new ControlError("Vercel project identity mismatch");
  return project;
}
