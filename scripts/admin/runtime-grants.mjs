import { createHash } from "node:crypto";
import { openBudgetSql } from "@call-nina/managed-generation/server";
import { ControlError, output } from "./configuration.mjs";
import { need } from "./credentials.mjs";
import { database } from "./database.mjs";
import { runtimeConnection, runtimeRole } from "./database-config.mjs";
import {
  functions,
  migrationPermissions,
  requireMigrationPermissions,
  runtimePermissions,
} from "./database-permissions.mjs";
export function marker() {
  return (
    "nina-runtime:" +
    createHash("sha256")
      .update(JSON.stringify([need("PGHOST_UNPOOLED"), need("PGDATABASE"), need("PGUSER")]))
      .digest("hex")
  );
}

export async function requireExistingRuntime(sql) {
  const role = runtimeRole();
  const found = await sql.query(
    "SELECT shobj_description(oid,'pg_authid') AS marker, NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit AND rolcanlogin AND NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=pg_roles.oid) AS safe FROM pg_roles WHERE rolname=$1",
    [role],
  );
  if (found.rows[0]?.marker !== marker() || found.rows[0]?.safe !== true)
    throw new ControlError(
      "Existing restricted runtime role is missing or unsafe; run explicit runtime-setup separately",
    );
}
async function checkRuntimeEndpoints(checkPermissions) {
  await database(requireExistingRuntime);
  for (const hostKey of ["PGHOST_UNPOOLED", "PGHOST"]) {
    const sql = openBudgetSql(runtimeConnection(hostKey));
    try {
      const result = await sql.query(
        "SELECT current_user=$1 AND session_user=$1 AND current_database()=$2 AND (SELECT shobj_description(oid,'pg_authid') FROM pg_roles WHERE rolname=current_user)=$3 AS expected_identity",
        [runtimeRole(), need("PGDATABASE"), marker()],
      );
      if (result.rows[0]?.expected_identity !== true)
        throw new ControlError("Runtime database identity mismatch; deployment refused");
      if (checkPermissions) await runtimePermissions(sql);
    } finally {
      await sql.close();
    }
  }
}
export async function verifyRuntimeIdentity() {
  // Authenticate before migrations, without requiring functions not installed yet.
  await checkRuntimeEndpoints(false);
}
export async function reconcileRuntime() {
  await verifyRuntimeIdentity();
  await database(async (sql) => {
    requireMigrationPermissions(await migrationPermissions(sql));
    await requireExistingRuntime(sql);
    const role = runtimeRole();
    for (const signature of functions) {
      const found = await sql.query("SELECT to_regprocedure($1) IS NOT NULL AS installed", [
        signature,
      ]);
      if (found.rows[0]?.installed !== true)
        throw new ControlError("Required runtime function is missing; apply migrations first");
    }
    await sql.query(
      `BEGIN; SELECT pg_advisory_xact_lock(787444223);
      REVOKE ALL ON SCHEMA nina_starter FROM ${role};
      REVOKE ALL ON ALL TABLES IN SCHEMA nina_starter FROM ${role};
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA nina_starter FROM ${role};
      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nina_starter FROM ${role};
      REVOKE ALL ON SCHEMA nina_sync FROM ${role};
      REVOKE ALL ON ALL TABLES IN SCHEMA nina_sync FROM ${role};
      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nina_sync FROM ${role};
      REVOKE ALL ON SCHEMA nina_speech FROM ${role};
      REVOKE ALL ON ALL TABLES IN SCHEMA nina_speech FROM ${role};
      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nina_speech FROM ${role};
      GRANT USAGE ON SCHEMA nina_starter,nina_sync,nina_speech TO ${role};
      GRANT EXECUTE ON FUNCTION ${functions.join(", ")} TO ${role}; COMMIT;`,
      [],
    );
    await runtimePermissions(sql);
  });
  await verifiedRuntimeConnection();
  output({ runtimeGrantsReconciled: true, credentialsChanged: false, inferenceActivated: false });
}
export async function verifiedRuntimeConnection() {
  await database((sql) => runtimePermissions(sql));
  await checkRuntimeEndpoints(true);
  return runtimeConnection();
}
