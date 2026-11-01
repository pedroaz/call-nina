import { context, summary } from "./common.mjs";
import { environment, results, selectionError, config } from "../admin/configuration.mjs";
import { need } from "../admin/credentials.mjs";
import { verify } from "./artifacts.mjs";
import { migrate } from "../admin/database.mjs";
import { verifyRuntimeIdentity, reconcileRuntime } from "../admin/runtime-grants.mjs";

export async function prepareDatabase() {
  const current = context("vercel");
  if (selectionError || !environment) throw new Error("Invalid database environment");
  for (const name of [
    "PGHOST",
    "PGHOST_UNPOOLED",
    "PGUSER",
    "PGDATABASE",
    "PGPASSWORD",
    "NINA_DATABASE_RUNTIME_PASSWORD",
  ])
    need(name);
  // Validate the same-run artifact before making any database changes.
  const manifest = await verify("hosting");
  if (
    manifest.projectId !== config.projectId ||
    manifest.teamId !== config.teamId ||
    manifest.origin !== config.origin
  )
    throw new Error(
      "Hosting artifact targets different infrastructure; database preparation refused",
    );
  await summary(
    `Database preparation: ${environment}; commit=${current.commit}. Completed migrations remain applied if a later stage fails.`,
  );
  try {
    await verifyRuntimeIdentity();
    await migrate();
    await reconcileRuntime();
  } finally {
    for (const result of results) {
      if (result.migration) await summary(`Migration ${result.migration}: ${result.status}`);
      if (result.runtimeGrantsReconciled)
        await summary("Existing runtime grants reconciled and verified; credentials unchanged.");
    }
  }
}
