import { ControlError } from "./configuration.mjs";
import { need } from "./credentials.mjs";
import { runtimeRole } from "./database-config.mjs";

export const functions = [
  "nina_sync.exchange(text,jsonb)",
  "nina_starter.access(text)",
  "nina_starter.reserve(uuid,uuid,text,text,bigint,text,text,text)",
  "nina_starter.permit(uuid,uuid,text)",
  "nina_starter.settle(uuid,uuid,bigint,integer,text,bigint,jsonb)",
];
export async function migrationPermissions(sql) {
  const result = await sql.query(
    `SELECT
    current_user = $1 AND session_user = $1 AS expected_identity,
    current_database() = $2 AS expected_database,
    NOT pg_is_in_recovery() AND current_setting('transaction_read_only') = 'off' AS writable_primary,
    has_database_privilege(current_user,current_database(),'CREATE') AS create_schema,
    has_schema_privilege(current_user,'public','USAGE') AND has_schema_privilege(current_user,'public','CREATE') AS migration_ledger_access,
    NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname IN ('nina_starter','nina_sync') AND NOT pg_has_role(nspowner,'USAGE')) AS owns_schema,
    NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE (n.nspname IN ('nina_starter','nina_sync') OR (n.nspname='public' AND c.relname='nina_migration')) AND NOT pg_has_role(c.relowner,'USAGE')) AS owns_tables,
    NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('nina_starter','nina_sync') AND NOT pg_has_role(p.proowner,'USAGE')) AS owns_functions,
    (SELECT rolcreaterole OR rolsuper FROM pg_roles WHERE rolname=current_user) AS can_create_roles,
    EXISTS(SELECT 1 FROM pg_roles WHERE rolname=$3) AS runtime_role_exists,
    coalesce((SELECT pg_has_role(current_user,oid,'MEMBER WITH ADMIN OPTION') FROM pg_roles WHERE rolname=$3),false) AS can_manage_existing_runtime_role`,
    [need("PGUSER"), need("PGDATABASE"), runtimeRole()],
  );
  return result.rows[0];
}
export function requireMigrationPermissions(checks) {
  const required = [
    "expected_identity",
    "expected_database",
    "writable_primary",
    "create_schema",
    "migration_ledger_access",
    "owns_schema",
    "owns_tables",
    "owns_functions",
  ];
  if (!checks || required.some((key) => checks[key] !== true))
    throw new ControlError(
      "Supplied PG role cannot safely own these migrations. Run database-check and resolve permissions with the existing database administrator; no ownership changes are automatic.",
    );
}
export async function runtimePermissions(sql) {
  const role = runtimeRole();
  const result = await sql.query(
    `SELECT
    NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls AND NOT r.rolinherit AND r.rolcanlogin AS restricted_login,
    NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid) AS no_memberships,
    NOT EXISTS(SELECT 1 FROM pg_database WHERE datdba=r.oid) AS not_database_owner,
    NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspowner=r.oid) AS not_schema_owner,
    NOT EXISTS(SELECT 1 FROM pg_class WHERE relowner=r.oid) AS not_table_owner,
    NOT EXISTS(SELECT 1 FROM pg_proc WHERE proowner=r.oid) AS not_function_owner,
    NOT has_database_privilege(r.oid,current_database(),'CREATE') AS cannot_create_schemas,
    NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND has_schema_privilege(r.oid,oid,'CREATE')) AS cannot_create_objects,
    NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp_%' AND
      ((c.relkind IN ('r','p','v','m','f') AND (has_table_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_any_column_privilege(r.oid,c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) OR (c.relkind='S' AND has_sequence_privilege(r.oid,c.oid,'USAGE,SELECT,UPDATE')))) AS no_direct_data_access,
    has_schema_privilege(r.oid,'nina_starter','USAGE') AND has_schema_privilege(r.oid,'nina_sync','USAGE') AS schema_usage,
    NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('nina_starter','nina_sync') AND has_function_privilege(r.oid,p.oid,'EXECUTE') AND p.oid NOT IN (${functions.map((_, i) => `to_regprocedure($${i + 2})`).join(",")})) AS no_internal_function_access
    FROM pg_roles r WHERE r.rolname=$1`,
    [role, ...functions],
  );
  const checks = result.rows[0];
  if (!checks || Object.values(checks).some((value) => value !== true))
    throw new ControlError(
      "Runtime role is missing or has unsafe effective privileges. Run explicit runtime-setup, or resolve inherited/PUBLIC privileges with the database administrator. No owner connection can be deployed.",
    );
  for (const signature of functions) {
    const allowed = await sql.query(
      "SELECT to_regprocedure($2) IS NOT NULL AND has_function_privilege($1,to_regprocedure($2),'EXECUTE') AS allowed",
      [role, signature],
    );
    if (allowed.rows[0]?.allowed !== true)
      throw new ControlError("Runtime function grants are incomplete; run runtime-setup");
  }
}
