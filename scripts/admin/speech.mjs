import { ControlError, output } from "./configuration.mjs";
import { database } from "./database.mjs";
export async function speechAdmin(name, user, characters, grantId) {
  return database(async (sql) => {
    if (name === "speech enable" || name === "speech disable")
      await sql.query(
        "INSERT INTO nina_speech.account(user_id,enabled) VALUES($1,$2::boolean) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled",
        [user.id, name === "speech enable"],
      );
    if (name === "speech grant") {
      await sql.query(
        "INSERT INTO nina_speech.account(user_id) VALUES($1) ON CONFLICT DO NOTHING",
        [user.id],
      );
      await sql.query(
        `WITH added AS (INSERT INTO nina_speech.grant(id,user_id,characters) VALUES($1::uuid,$2,$3::bigint) ON CONFLICT(id) DO NOTHING RETURNING characters)
    UPDATE nina_speech.account SET remaining_characters=remaining_characters+(SELECT characters FROM added) WHERE user_id=$2 AND EXISTS(SELECT 1 FROM added)`,
        [grantId, user.id, characters],
      );
      const prior = await sql.query(
        "SELECT user_id,characters FROM nina_speech.grant WHERE id=$1::uuid",
        [grantId],
      );
      if (prior.rows[0]?.user_id !== user.id || Number(prior.rows[0]?.characters) !== characters)
        throw new ControlError("Grant ID belongs to a different speech grant");
    }
    const account = await sql.query("SELECT * FROM nina_speech.access($1)", [user.id]);
    const usage = await sql.query(
      "SELECT state,dispatched,delivered,count(*) AS requests,sum(characters) AS characters,sum(CASE WHEN delivered THEN cost_micro_usd ELSE 0 END) AS incurred_provider_micro_usd,sum(CASE WHEN dispatched AND NOT delivered THEN cost_micro_usd ELSE 0 END) AS uncertain_provider_micro_usd FROM nina_speech.request WHERE user_id=$1 GROUP BY state,dispatched,delivered",
      [user.id],
    );
    const budget = await sql.query(
      "SELECT enabled,cap_micro_usd,charged_micro_usd FROM nina_speech.budget",
      [],
    );
    output({
      userId: user.id,
      account: account.rows,
      usage: usage.rows,
      pilotBudget: budget.rows,
      ...(grantId ? { grantId } : {}),
    });
  });
}
