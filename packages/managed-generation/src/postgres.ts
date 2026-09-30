import postgres from "postgres";
import type { BudgetSql } from "./budget.js";
import { ManagedFailure } from "./protocol.js";

export function openBudgetSql(connectionString: string): BudgetSql & { close(): Promise<void> } {
  // No local socket/ambient PG environment fallback; URL never reaches logs.
  const url = new URL(connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    url.pathname.length <= 1 ||
    url.search ||
    url.hash
  )
    throw new ManagedFailure("unavailable");
  const sql = postgres({
    host: url.hostname,
    port: Number(url.port || 5432),
    database: decodeURIComponent(url.pathname.slice(1)),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: true },
    max: 2,
    connect_timeout: 5,
    idle_timeout: 10,
    max_lifetime: 60,
    prepare: false,
    debug: false,
    onnotice: () => undefined,
    connection: {
      statement_timeout: 5000,
      lock_timeout: 3000,
      application_name: "nina-starter-budget",
    },
  });
  return {
    async query(text, values) {
      try {
        const rows = await sql.unsafe(text, [...values]);
        return { rows: [...rows] };
      } catch {
        throw new ManagedFailure("unavailable");
      }
    },
    async close() {
      await sql.end({ timeout: 5 });
    },
  };
}
