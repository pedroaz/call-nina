import { ControlError, config, output } from "./configuration.mjs";
import { need, secret } from "./credentials.mjs";

export function runtimeRole() {
  if (!/^[a-z][a-z0-9_]{0,40}$/.test(config.runtimeRole) || config.runtimeRole === need("PGUSER"))
    throw new ControlError(
      "Runtime role must be valid and different from the supplied administration role",
    );
  return config.runtimeRole;
}
function connection(hostKey, user, password) {
  const host = need(hostKey);
  // Accept DNS hostnames only, never a URL, socket, port override or connection options.
  if (!/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host))
    throw new ControlError(`Invalid ${hostKey}; expected a database hostname`);
  const database = need("PGDATABASE");
  if (
    [user, password, database].some((value) => !value || value.includes("\0")) ||
    [".", ".."].includes(database)
  )
    throw new ControlError("Invalid PostgreSQL connection parameters");
  const url = new URL(`postgresql://${host}:5432`);
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(password);
  url.pathname = `/${encodeURIComponent(database)}`;
  if (
    decodeURIComponent(url.username) !== user ||
    decodeURIComponent(url.password) !== password ||
    decodeURIComponent(url.pathname.slice(1)) !== database
  )
    throw new ControlError("PostgreSQL parameters could not be encoded safely");
  // The adapter supplies rejectUnauthorized:true. No URL TLS overrides or ambient PG fallback.
  return url.href;
}
export const ownerConnection = () =>
  connection("PGHOST_UNPOOLED", need("PGUSER"), need("PGPASSWORD"));
export function runtimeConnection() {
  const password = need("NINA_DATABASE_RUNTIME_PASSWORD");
  if (password === need("PGPASSWORD"))
    throw new ControlError("Runtime and administration passwords must be separate");
  return connection("PGHOST", runtimeRole(), password);
}
export function connectExisting() {
  ownerConnection();
  // Validate the runtime host without generating or persisting credentials.
  connection(
    "PGHOST",
    runtimeRole(),
    secret("NINA_DATABASE_RUNTIME_PASSWORD") || "validation-only",
  );
  output({
    configurationValid: true,
    source: "Existing Vercel Marketplace database; root .env PG parameters",
    administrationHost: "PGHOST_UNPOOLED",
    runtimeHost: "PGHOST (adapter uses prepare:false)",
    credentialsReused: ["PGUSER", "PGPASSWORD", "PGDATABASE"],
    additionalRuntimeCredential:
      "NINA_DATABASE_RUNTIME_PASSWORD: generated only by explicit runtime-setup",
    connectionsPersisted: false,
    remoteConnectionAttempted: false,
    permissionsVerified: false,
    next: [
      "node scripts/admin/index.mjs infra database-check",
      "node scripts/admin/index.mjs infra migrate",
      "node scripts/admin/index.mjs infra runtime-setup",
      "node scripts/admin/index.mjs infra apply",
      "node scripts/admin/index.mjs deploy",
    ],
    inferenceActivated: false,
  });
}
