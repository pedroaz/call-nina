import { createHash } from "node:crypto";
import { clerk, identity } from "./providers.mjs";
import { database } from "./database.mjs";
import { ControlError, output } from "./configuration.mjs";
import { confirm } from "./review.mjs";
export async function resetBeta(expectedDigest, yes) {
  const instance = await identity();
  const users = [];
  for (let offset = 0; ; offset += 100) {
    const page = await clerk(`/users?limit=100&offset=${offset}&order_by=created_at`);
    users.push(...page.map(({ id, username }) => ({ id, username })));
    if (page.length < 100) break;
    if (users.length >= 1000) throw new ControlError("Beta reset is limited to 1000 users");
  }
  const digest = createHash("sha256")
    .update(JSON.stringify({ instance: instance.id, ids: users.map((user) => user.id).sort() }))
    .digest("hex");
  if (yes && digest !== expectedDigest)
    throw new ControlError(
      "Beta user list changed or review digest missing; review again before deletion",
    );
  await confirm(
    {
      operation: "users reset-beta",
      instanceId: instance.id,
      users,
      digest,
      deletes: ["Clerk beta identities", "hosted flashcard snapshots"],
      retains: ["local learner folders", "financial accounting", "global budget charges"],
    },
    yes,
  );
  // Quiescence is required. Never turn an active reservation into new free budget.
  await database(async (sql) => {
    const enabled = await sql.query(
      "SELECT EXISTS(SELECT 1 FROM nina_starter.budget WHERE enabled) OR EXISTS(SELECT 1 FROM nina_speech.budget WHERE enabled) AS enabled",
      [],
    );
    if (enabled.rows[0]?.enabled)
      throw new ControlError("Disable global AI and speech budgets before beta reset");
    const active = await sql.query(
      "SELECT EXISTS(SELECT 1 FROM nina_starter.reservation WHERE NOT settled AND lease_until > clock_timestamp()) AS active",
      [],
    );
    if (active.rows[0]?.active)
      throw new ControlError("Drain active AI requests before beta reset");
  });
  for (const user of users) {
    await database(async (sql) => {
      await sql.query("BEGIN", []);
      try {
        await sql.query("SELECT id FROM nina_starter.budget ORDER BY id FOR UPDATE", []);
        await sql.query("SELECT id FROM nina_speech.budget FOR UPDATE", []);
        const enabled = await sql.query(
          "SELECT EXISTS(SELECT 1 FROM nina_starter.budget WHERE enabled) OR EXISTS(SELECT 1 FROM nina_speech.budget WHERE enabled) AS enabled",
          [],
        );
        if (enabled.rows[0]?.enabled)
          throw new ControlError("Global budgets were enabled during reset; stop and inspect");
        const speech = await sql.query(
          "SELECT 1 FROM nina_speech.request WHERE user_id=$1 AND state='reserved'",
          [user.id],
        );
        if (speech.rows.length)
          throw new ControlError("Settle speech requests before deleting this beta user");
        await sql.query(
          "INSERT INTO nina_starter.account_event(user_id,kind,details) SELECT $1,'beta-reset',jsonb_build_object('tier',a.tier,'revokedActions',a.remaining_actions,'revokedCharacters',coalesce(s.remaining_characters,0)) FROM (SELECT $1::text AS user_id) u LEFT JOIN nina_starter.account a ON a.user_id=u.user_id LEFT JOIN nina_speech.account s ON s.user_id=u.user_id",
          [user.id],
        );
        await sql.query(
          "UPDATE nina_starter.account SET tier='free',hosted_ai_enabled=false,remaining_actions=0,updated_at=clock_timestamp() WHERE user_id=$1",
          [user.id],
        );
        await sql.query(
          "UPDATE nina_speech.account SET enabled=false,remaining_characters=0 WHERE user_id=$1",
          [user.id],
        );
        await sql.query("DELETE FROM nina_sync.snapshot WHERE user_id=$1", [user.id]);
        await sql.query("DELETE FROM nina_sync.library WHERE user_id=$1", [user.id]);
        await sql.query("COMMIT", []);
      } catch (error) {
        await sql.query("ROLLBACK", []);
        throw error;
      }
    });
    await clerk(`/users/${encodeURIComponent(user.id)}`, "DELETE");
    output({ deletedBetaUser: user.id });
  }
  const remaining = await clerk("/users?limit=1");
  if (remaining.length)
    throw new ControlError("Users appeared during reset; inspect before continuing");
  output({ reset: true, deleted: users.length, financialRecordsRetained: true });
}
