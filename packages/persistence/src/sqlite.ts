import { bindOriginatingDevice } from "./originating-device.js";
import { DatabaseSync } from "node:sqlite";
import { lstat, open } from "node:fs/promises";

import type { DataRootGeneration } from "@call-nina/contracts";

import {
  assertCurrentDataRootLease,
  readOrCreateOriginatingDeviceId,
} from "./bootstrap-pointer.js";
import { resolveDataRootLayout } from "./data-root-layout.js";

export const sqliteBusyTimeoutMilliseconds = 2_000;

export type DatabaseMigration = Readonly<{
  version: number;
  name: string;
  sql: string;
  migrate?: (connection: DatabaseSync) => void;
}>;

const connections = new WeakMap<CallNinaDatabase, DatabaseSync>();
const connectionQueues = new WeakMap<CallNinaDatabase, Promise<void>>();

// Serialize reads as well as writes: a read must not observe another operation's
// uncommitted changes while its asynchronous lease check is pending.
function withExclusiveConnection<T>(handle: CallNinaDatabase, operation: () => Promise<T>) {
  const result = (connectionQueues.get(handle) ?? Promise.resolve()).then(operation);
  connectionQueues.set(
    handle,
    result.then(
      () => undefined,
      () => undefined,
    ),
  );
  return result;
}
const leases = new WeakMap<
  CallNinaDatabase,
  Readonly<{ bootstrapFile: string; dataRoot: string; rootGeneration: DataRootGeneration }>
>();

export class CallNinaDatabase {
  #closed = false;
  readonly schemaVersion: number;
  readonly journalMode: "wal";
  readonly foreignKeysEnabled: true;
  readonly busyTimeoutMilliseconds: number;
  readonly rootGeneration: DataRootGeneration;

  constructor(options: {
    connection: DatabaseSync;
    schemaVersion: number;
    busyTimeoutMilliseconds: number;
    lease: Readonly<{
      bootstrapFile: string;
      dataRoot: string;
      rootGeneration: DataRootGeneration;
    }>;
  }) {
    this.schemaVersion = options.schemaVersion;
    this.journalMode = "wal";
    this.foreignKeysEnabled = true;
    this.busyTimeoutMilliseconds = options.busyTimeoutMilliseconds;
    this.rootGeneration = options.lease.rootGeneration;
    connections.set(this, options.connection);
    leases.set(this, options.lease);
  }

  close(): void {
    if (this.#closed) return;
    connectionFor(this).close();
    connections.delete(this);
    leases.delete(this);
    this.#closed = true;
  }

  get closed(): boolean {
    return this.#closed;
  }
}

export function connectionFor(handle: CallNinaDatabase): DatabaseSync {
  const connection = connections.get(handle);
  if (!connection) throw new Error("OD_DATABASE_CLOSED");
  return connection;
}

export async function withLeasedConnection<T>(
  handle: CallNinaDatabase,
  operation: (connection: DatabaseSync) => T | Promise<T>,
): Promise<T> {
  return withExclusiveConnection(handle, async () => {
    const lease = leases.get(handle);
    if (!lease) throw new Error("OD_DATABASE_CLOSED");
    await assertCurrentDataRootLease(lease);
    const result = await operation(connectionFor(handle));
    await assertCurrentDataRootLease(lease);
    return result;
  });
}

export async function withLeasedTransaction<T>(
  handle: CallNinaDatabase,
  operation: (connection: DatabaseSync) => T | Promise<T>,
): Promise<T> {
  return withExclusiveConnection(handle, async () => {
    const lease = leases.get(handle);
    if (!lease) throw new Error("OD_DATABASE_CLOSED");
    await assertCurrentDataRootLease(lease);
    const connection = connectionFor(handle);
    try {
      connection.exec("BEGIN IMMEDIATE;");
    } catch (error) {
      throw normalizeDatabaseContention(error);
    }
    try {
      const result = await operation(connection);
      await assertCurrentDataRootLease(lease);
      connection.exec("COMMIT;");
      return result;
    } catch (error) {
      try {
        connection.exec("ROLLBACK;");
      } catch {
        // The original operation or lease failure remains authoritative.
      }
      throw normalizeDatabaseContention(error);
    }
  });
}

function normalizeDatabaseContention(error: unknown): unknown {
  const code =
    error && typeof error === "object" ? (error as Record<string, unknown>)["code"] : undefined;
  const message = error instanceof Error ? error.message : "";
  if (code === "SQLITE_BUSY" || /database is (?:locked|busy)/iu.test(message)) {
    return new Error("OD_DATABASE_BUSY");
  }
  return error;
}

export async function assertCallNinaDatabaseLease(handle: CallNinaDatabase): Promise<void> {
  await withLeasedConnection(handle, () => undefined);
}

function readIntegerPragma(connection: DatabaseSync, pragma: string, field: string): number {
  const row = connection.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown> | undefined;
  const value = row?.[field];
  if (!Number.isSafeInteger(value)) throw new Error("OD_DATABASE_PRAGMA_INVALID");
  return value as number;
}

function readTextPragma(connection: DatabaseSync, pragma: string, field: string): string {
  const row = connection.prepare(`PRAGMA ${pragma}`).get() as Record<string, unknown> | undefined;
  const value = row?.[field];
  if (typeof value !== "string") throw new Error("OD_DATABASE_PRAGMA_INVALID");
  return value;
}

function validateMigrations(migrations: readonly DatabaseMigration[]): void {
  for (const [index, migration] of migrations.entries()) {
    if (
      migration.version !== index + 1 ||
      !/^[a-z][a-z0-9-]{2,79}$/u.test(migration.name) ||
      migration.sql.trim().length === 0 ||
      /(?:^|;)\s*(?:BEGIN(?:\s+(?:DEFERRED|IMMEDIATE|EXCLUSIVE|TRANSACTION))?|COMMIT|ROLLBACK)\s*;/imu.test(
        migration.sql,
      ) ||
      /PRAGMA\s+user_version/iu.test(migration.sql)
    ) {
      throw new Error("OD_DATABASE_MIGRATION_SET_INVALID");
    }
  }
}

function migrate(connection: DatabaseSync, migrations: readonly DatabaseMigration[]): number {
  validateMigrations(migrations);
  let currentVersion = readIntegerPragma(connection, "user_version", "user_version");
  if (currentVersion > migrations.length) throw new Error("OD_DATABASE_SCHEMA_NEWER");

  for (const migration of migrations.slice(currentVersion)) {
    try {
      connection.exec("BEGIN IMMEDIATE;");
      connection.exec(migration.sql);
      migration.migrate?.(connection);
      connection.exec(`PRAGMA user_version = ${String(migration.version)};`);
      connection.exec("COMMIT;");
      currentVersion = migration.version;
    } catch (error) {
      try {
        connection.exec("ROLLBACK;");
      } catch {
        // The original migration failure remains authoritative.
      }
      const normalized = normalizeDatabaseContention(error);
      if (normalized instanceof Error && normalized.message === "OD_DATABASE_BUSY")
        throw normalized;
      throw new Error(`OD_DATABASE_MIGRATION_FAILED:${String(migration.version)}`);
    }
  }
  return currentVersion;
}

async function ensurePrivateDatabaseFile(databasePath: string): Promise<void> {
  try {
    const file = await open(databasePath, "wx", 0o600);
    await file.close();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const metadata = await lstat(databasePath);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error("OD_DATABASE_PATH_UNSAFE");
    }
  }
}

export async function openDataRootDatabase(options: {
  bootstrapFile: string;
  dataRoot: string;
  rootGeneration: DataRootGeneration;
  migrations: readonly DatabaseMigration[];
  busyTimeoutMilliseconds?: number;
}): Promise<CallNinaDatabase> {
  return openDataRootDatabaseInternal(options, true);
}

export async function prepareDataRootDatabase(options: {
  bootstrapFile: string;
  dataRoot: string;
  rootGeneration: DataRootGeneration;
  migrations: readonly DatabaseMigration[];
  busyTimeoutMilliseconds?: number;
}): Promise<CallNinaDatabase> {
  return openDataRootDatabaseInternal(options, false);
}

async function openDataRootDatabaseInternal(
  options: {
    bootstrapFile: string;
    dataRoot: string;
    rootGeneration: DataRootGeneration;
    migrations: readonly DatabaseMigration[];
    busyTimeoutMilliseconds?: number;
  },
  requireCurrentLease: boolean,
): Promise<CallNinaDatabase> {
  if (requireCurrentLease) await assertCurrentDataRootLease(options);
  const timeout = options.busyTimeoutMilliseconds ?? sqliteBusyTimeoutMilliseconds;
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 10_000) {
    throw new Error("OD_DATABASE_BUSY_TIMEOUT_INVALID");
  }
  const layout = resolveDataRootLayout(options.dataRoot);
  await ensurePrivateDatabaseFile(layout.database);

  const connection = new DatabaseSync(layout.database, { timeout });
  try {
    connection.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = ${String(timeout)};
      PRAGMA trusted_schema = OFF;
    `);
    if (
      readTextPragma(connection, "journal_mode", "journal_mode") !== "wal" ||
      readIntegerPragma(connection, "foreign_keys", "foreign_keys") !== 1 ||
      readIntegerPragma(connection, "busy_timeout", "timeout") !== timeout
    ) {
      throw new Error("OD_DATABASE_CONFIGURATION_FAILED");
    }
    bindOriginatingDevice(connection, await readOrCreateOriginatingDeviceId(options.bootstrapFile));
    const schemaVersion = migrate(connection, options.migrations);
    if (requireCurrentLease) await assertCurrentDataRootLease(options);
    connection.enableDefensive(true);
    return new CallNinaDatabase({
      connection,
      schemaVersion,
      busyTimeoutMilliseconds: timeout,
      lease: {
        bootstrapFile: options.bootstrapFile,
        dataRoot: options.dataRoot,
        rootGeneration: options.rootGeneration,
      },
    });
  } catch (error) {
    connection.close();
    throw error;
  }
}
