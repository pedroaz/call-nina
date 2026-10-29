import { createHash, randomBytes } from "node:crypto";
import { openBudgetSql } from "@call-nina/managed-generation/server";
import { ControlError, output } from "./configuration.mjs";
import { need, secret, saveSecrets } from "./credentials.mjs";
import { database } from "./database.mjs";
import { runtimeConnection, runtimeRole } from "./database-config.mjs";
import {
  functions,
  migrationPermissions,
  requireMigrationPermissions,
  runtimePermissions,
} from "./database-permissions.mjs";
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
function marker() {
  return (
    "nina-runtime:" +
    createHash("sha256")
      .update(JSON.stringify([need("PGHOST_UNPOOLED"), need("PGDATABASE"), need("PGUSER")]))
      .digest("hex")
  );
}
export async function setupRuntime() {
  await database(async (sql) => {
    const permissions = await migrationPermissions(sql);
    requireMigrationPermissions(permissions);
    if (
      !permissions.can_create_roles ||
      (permissions.runtime_role_exists && !permissions.can_manage_existing_runtime_role)
    )
      throw new ControlError(
        "Supplied PG role lacks role-management permissions; ask the existing database administrator to grant the required authority. No automatic elevation.",
      );
    const role = runtimeRole();
    const existing = await sql.query(
      "SELECT shobj_description(oid,'pg_authid') AS marker, NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AS safe FROM pg_roles WHERE rolname=$1",
      [role],
    );
    if (
      existing.rows.length &&
      (existing.rows[0].marker !== marker() || existing.rows[0].safe !== true)
    )
      throw new ControlError(
        "Runtime role already exists without this database's Nina ownership marker; refusing to adopt or modify it",
      );
    if (existing.rows.length && !secret("NINA_DATABASE_RUNTIME_PASSWORD"))
      throw new ControlError(
        "Existing runtime role requires its saved password; no automatic password rotation",
      );
    for (const signature of functions) {
      const found = await sql.query("SELECT to_regprocedure($1) IS NOT NULL AS installed", [
        signature,
      ]);
      if (found.rows[0]?.installed !== true)
        throw new ControlError("Run migrations explicitly before restricted-role setup");
    }
    const password =
      secret("NINA_DATABASE_RUNTIME_PASSWORD") || randomBytes(32).toString("base64url");
    if (password === need("PGPASSWORD"))
      throw new ControlError("Runtime password must be different from the owner password");
    // Persist once before the remote mutation, so a lost response does not lose credentials.
    if (!secret("NINA_DATABASE_RUNTIME_PASSWORD"))
      await saveSecrets({ NINA_DATABASE_RUNTIME_PASSWORD: password });
    await sql.query(
      `BEGIN; SET LOCAL standard_conforming_strings=on;
      SELECT pg_advisory_xact_lock(787444223);
      DO $role$ BEGIN
        IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${quote(role)}) THEN
          IF (SELECT shobj_description(oid,'pg_authid') FROM pg_roles WHERE rolname=${quote(role)}) IS DISTINCT FROM ${quote(marker())} THEN RAISE EXCEPTION 'runtime role ownership changed'; END IF;
          IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${quote(role)} AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) THEN RAISE EXCEPTION 'unsafe runtime role'; END IF;
          IF EXISTS(SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=${quote(role)}) THEN RAISE EXCEPTION 'runtime memberships require review'; END IF;
        ELSE CREATE ROLE ${role} LOGIN NOINHERIT;
        END IF;
      END $role$;
      ALTER ROLE ${role} PASSWORD ${quote(password)} LOGIN NOINHERIT;
      COMMENT ON ROLE ${role} IS ${quote(marker())};
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
    output({ completed: "Restricted runtime role reconciliation" });
    await runtimePermissions(sql);
  });
  await verifiedRuntimeConnection();
  output({
    runtimeRoleConfigured: true,
    runtimeCredentialStored: true,
    inferenceActivated: false,
    next: "Run infra apply explicitly to configure Vercel; deployment is separate",
  });
}
export async function verifiedRuntimeConnection() {
  const connectionString = runtimeConnection();
  await database((sql) => runtimePermissions(sql));
  const sql = openBudgetSql(connectionString);
  try {
    const result = await sql.query(
      "SELECT current_user=$1 AND session_user=$1 AND current_database()=$2 AND (SELECT shobj_description(oid,'pg_authid') FROM pg_roles WHERE rolname=current_user)=$3 AS expected_identity",
      [runtimeRole(), need("PGDATABASE"), marker()],
    );
    if (result.rows[0]?.expected_identity !== true)
      throw new ControlError("Runtime database identity mismatch; deployment refused");
    // Verify effective privileges on the pooled endpoint as well, rather than assuming both hosts match.
    await runtimePermissions(sql);
  } finally {
    await sql.close();
  }
  return connectionString;
}
