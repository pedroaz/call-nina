import { ControlError } from "./configuration.mjs";

import { randomBytes } from "node:crypto";
import { clerk, identity } from "./providers.mjs";
import { database } from "./database.mjs";
export function positive(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1 || result > 1000000)
    throw new ControlError("Actions must be between 1 and 1000000");
  return result;
}
export async function findUser(username) {
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(username ?? ""))
    throw new ControlError("Provide a 4–64 character username using letters, numbers, _ or -");
  await identity();
  const users = await clerk(`/users?username=${encodeURIComponent(username)}&limit=2`);
  if (users.length > 1) throw new ControlError("Ambiguous username");
  return users[0];
}

export async function changeAccess(user, action) {
  await database((sql) =>
    sql.query(
      "INSERT INTO nina_starter.account(user_id,hosted_ai_enabled) VALUES($1,$2::boolean) ON CONFLICT(user_id) DO UPDATE SET hosted_ai_enabled=excluded.hosted_ai_enabled,updated_at=clock_timestamp()",
      [user.id, action === "enable-ai" ? "true" : "false"],
    ),
  );
}
export async function passwordOperation(username, action, user) {
  if (action === "create" && user)
    throw new ControlError("User already exists; use reset-password explicitly");
  if (action === "reset-password" && !user) throw new ControlError("User not found");
  const password = randomBytes(24).toString("base64url");
  const result =
    action === "create"
      ? await clerk("/users", "POST", { username, password })
      : await clerk(`/users/${user.id}`, "PATCH", { password, sign_out_of_other_sessions: true });
  return { user: result, password };
}
