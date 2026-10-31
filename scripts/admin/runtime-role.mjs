import { randomBytes } from "node:crypto";
import { ControlError, output } from "./configuration.mjs";
import { need, secret, saveSecrets } from "./credentials.mjs";
import { database } from "./database.mjs";
import { runtimeRole } from "./database-config.mjs";
import {
  functions,
  migrationPermissions,
  requireMigrationPermissions,
} from "./database-permissions.mjs";
import { marker, reconcileRuntime } from "./runtime-grants.mjs";
export { verifiedRuntimeConnection } from "./runtime-grants.mjs";
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
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
      COMMIT;`,
      [],
    );
    output({ completed: "Restricted runtime role reconciliation" });
  });
  await reconcileRuntime();
  output({
    runtimeRoleConfigured: true,
    runtimeCredentialStored: true,
    inferenceActivated: false,
    next: "Run infra apply explicitly to configure Vercel; deployment is separate",
  });
}
