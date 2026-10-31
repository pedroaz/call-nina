import { ControlError, output } from "./configuration.mjs";
import { ownerConnection } from "./database-config.mjs";
import { migrationPermissions, requireMigrationPermissions } from "./database-permissions.mjs";
import { migrationCatalog } from "./migration-catalog.mjs";
import postgres from "postgres";
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
export async function database(work) {
  const url = new URL(ownerConnection());
  const connection = postgres({
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: true },
    max: 1,
    prepare: false,
    connect_timeout: 5,
    idle_timeout: 10,
    debug: false,
    onnotice: () => undefined,
    connection: { statement_timeout: 30000, lock_timeout: 3000, application_name: "nina-admin" },
  });
  const sql = {
    async query(text, values) {
      try {
        const query = connection.unsafe(text, [...values]);
        // Only parameter-free admin batches use the simple protocol. Runtime stays unchanged.
        const rows = await (values.length ? query : query.simple());
        return { rows: [...rows] };
      } catch (error) {
        const code = /^[0-9A-Z]{5}$/.test(error.code ?? "") ? ` (SQLSTATE ${error.code})` : "";
        throw new ControlError(
          `Database administration failed${code}; inspect state before retrying`,
        );
      }
    },
  };
  try {
    return await work(sql);
  } finally {
    await connection.end({ timeout: 5 });
  }
}
export async function migrate() {
  await database(async (sql) => {
    requireMigrationPermissions(await migrationPermissions(sql));
    const catalog = await migrationCatalog();
    // Keep catalog validation and application serialized with other migration runners.
    await sql.query("SELECT pg_advisory_lock(787444223)", []);
    try {
      const ledger = await sql.query(
        "SELECT to_regclass('public.nina_migration') IS NOT NULL AS installed",
        [],
      );
      const applied = ledger.rows[0]?.installed
        ? (await sql.query("SELECT name,digest FROM public.nina_migration ORDER BY name", [])).rows
        : [];
      for (const [index, row] of applied.entries()) {
        const migration = catalog[index];
        if (!migration || migration.name !== row.name || migration.digest !== row.digest)
          throw new ControlError(
            "Migration history differs from this checkout; no migrations applied",
          );
      }
      for (const { name, digest, body } of catalog) {
        if (applied.some((row) => row.name === name)) {
          output({ migration: name, status: "skipped" });
          continue;
        }
        await sql.query(
          `BEGIN; SELECT pg_advisory_xact_lock(787444223);
          CREATE TABLE IF NOT EXISTS public.nina_migration(name text PRIMARY KEY, digest text NOT NULL);
          DO $migration$ BEGIN
            ${body}
            INSERT INTO public.nina_migration VALUES(${quote(name)},${quote(digest)});
          END $migration$; COMMIT;`,
          [],
        );
        output({ migration: name, status: "applied" });
      }
    } finally {
      // A failed SQL batch may leave a transaction aborted; release it before unlocking.
      await sql.query("ROLLBACK", []);
      await sql.query("SELECT pg_advisory_unlock(787444223)", []);
    }
    output({ migrated: true, inferenceActivated: false });
  });
}

export async function checkDatabase() {
  return database(async (sql) =>
    output({
      permissions: await migrationPermissions(sql),
      readOnly: true,
      inferenceActivated: false,
    }),
  );
}
