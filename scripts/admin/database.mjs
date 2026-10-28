import { ControlError, here, output } from "./configuration.mjs";
import { ownerConnection } from "./database-config.mjs";
import { migrationPermissions, requireMigrationPermissions } from "./database-permissions.mjs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
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
    for (const name of ["001-budget.sql", "002-accounts.sql", "003-ai-access.sql", "004-mobile-sync.sql"]) {
      const source = await readFile(
        new URL(`../../packages/managed-generation/sql/${name}`, here),
        "utf8",
      );
      const hash = createHash("sha256").update(source).digest("hex");
      const body = source.replace(/^BEGIN;$/m, "").replace(/^COMMIT;$/m, "");
      await sql.query(
        `BEGIN; SELECT pg_advisory_xact_lock(787444223);
        CREATE TABLE IF NOT EXISTS public.nina_migration(name text PRIMARY KEY, digest text NOT NULL);
        DO $migration$ BEGIN
          IF EXISTS(SELECT 1 FROM public.nina_migration WHERE name=${quote(name)} AND digest<>${quote(hash)}) THEN RAISE EXCEPTION 'migration changed'; END IF;
          IF NOT EXISTS(SELECT 1 FROM public.nina_migration WHERE name=${quote(name)}) THEN
            ${body}
            INSERT INTO public.nina_migration VALUES(${quote(name)},${quote(hash)});
          END IF;
        END $migration$; COMMIT;`,
        [],
      );
      output({ completed: "migration", name });
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
