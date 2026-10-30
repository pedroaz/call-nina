import { lstat, open, rename, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseEnv } from "node:util";
import { ControlError, root, environment } from "./configuration.mjs";
export const credentialNames = [
  "CLERK_SECRET_KEY",
  "CLERK_APPLICATION_ID",
  "CLERK_INSTANCE_ID",
  "CLERK_ISSUER_URL",
  "CLERK_PUBLISHABLE_KEY",
  "VERCEL_TOKEN",
  "PGHOST",
  "PGHOST_UNPOOLED",
  "PGUSER",
  "PGDATABASE",
  "PGPASSWORD",
  "NINA_DATABASE_RUNTIME_PASSWORD",
  "NINA_STARTER_GATEWAY_API_KEY",
  "NINA_STARTER_THROTTLE_HMAC_KEY",
];
const file = environment ? new URL(`.env.${environment}`, root) : null;
let values = {};
async function privateText(location) {
  try {
    const handle = await open(location, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.mode & 0o077)
        throw new ControlError(
          "Credential file must be a regular private file; use chmod 600 .env",
        );
      return await handle.readFile("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}
export async function loadCredentials() {
  if (!file)
    throw new ControlError("Select --environment preview or production before loading credentials");
  values = parseEnv(await privateText(file));
}
export const secret = (name) => process.env[name] ?? values[name];
export function need(name) {
  const value = secret(name);
  if (!value)
    throw new ControlError(
      `Missing credential: ${name}. Set it in the selected .env.${environment} file.`,
    );
  return value;
}
export function credentialStatus() {
  return credentialNames.map((name) => ({
    name,
    present: Boolean(secret(name)),
    source:
      process.env[name] !== undefined
        ? "environment"
        : values[name] !== undefined
          ? `.env.${environment}`
          : "missing",
  }));
}
export async function saveSecrets(changes) {
  if (!file) throw new ControlError("Select an environment before saving credentials");
  const original = await privateText(file);
  const parsed = parseEnv(original);
  for (const [name, value] of Object.entries(changes)) {
    if (!credentialNames.includes(name) || typeof value !== "string" || /[\r\n\0]/.test(value))
      throw new ControlError("Invalid credential name or multiline value");
    if (process.env[name] !== undefined && process.env[name] !== value)
      throw new ControlError(
        `Environment override conflicts with ${name}; resolve it before saving`,
      );
  }
  // Preserve unrelated dotenv entries and comments, including multiline values.
  let text = original;
  for (const [name, value] of Object.entries(changes)) {
    const quoted = !value.includes("'")
      ? `'${value}'`
      : !value.includes('"')
        ? `"${value}"`
        : !value.includes("`")
          ? "`" + value + "`"
          : null;
    if (quoted === null)
      throw new ControlError("Credential cannot be represented safely in dotenv");
    const entry = new RegExp(
      `^(?:export[ \\t]+)?${name}[ \\t]*=[ \\t]*(?:"[^"\\r]*"|'[^'\\r]*'|\x60[^\x60\\r]*\x60|[^\\r\\n]*)[ \\t]*(?:#[^\\r\\n]*)?(?:\\r?\\n|$)`,
      "gm",
    );
    text = text.replace(entry, "");
    text = text.replace(/\n?$/, "\n") + `${name}=${quoted}\n`;
  }
  const resulting = parseEnv(text);
  for (const [name, value] of Object.entries({ ...parsed, ...changes }))
    if (resulting[name] !== value)
      throw new ControlError("Cannot preserve dotenv content safely; edit .env manually");
  const temporary = new URL(`.env.${environment}.${randomUUID()}.tmp`, root);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(text);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if ((await privateText(file)) !== original)
      throw new ControlError(".env changed during this operation; retry after reviewing it");
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
  values = resulting;
}
export async function legacyImport() {
  const legacy = new URL(".vercel/nina-pilot-secrets.json", root);
  try {
    if ((await lstat(new URL(".vercel/", root))).isSymbolicLink())
      throw new ControlError("Refusing linked legacy credential directory");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const text = await privateText(legacy);
  if (!text) throw new ControlError("No legacy credential file found");
  const incoming = JSON.parse(text);
  for (const [name, value] of Object.entries(incoming)) {
    if (!credentialNames.includes(name) || typeof value !== "string")
      throw new ControlError("Unknown legacy credential entry");
    if (secret(name) !== undefined && secret(name) !== value)
      throw new ControlError(`Conflicting ${name}; resolve it explicitly before importing`);
  }
  return incoming;
}
export { childEnvironment } from "../lib/environment.mjs";
