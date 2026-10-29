import { ControlError, output } from "./configuration.mjs";

import { database } from "./database.mjs";
export async function topup(sql, userId, actions, grantId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(grantId ?? ""))
    throw new ControlError("Provide a stable UUID grant ID; reuse it when retrying a top-up");
  await sql.query("INSERT INTO nina_starter.account(user_id) VALUES($1) ON CONFLICT DO NOTHING", [
    userId,
  ]);
  const result = await sql.query(
    `WITH inserted AS (
    INSERT INTO nina_starter.allowance_grant(id,user_id,actions) SELECT $1::uuid,$2,$3::bigint FROM nina_starter.account WHERE user_id=$2
    ON CONFLICT(id) DO NOTHING RETURNING actions
  ) UPDATE nina_starter.account SET remaining_actions=remaining_actions+(SELECT actions FROM inserted),updated_at=clock_timestamp()
    WHERE user_id=$2 AND EXISTS(SELECT 1 FROM inserted) RETURNING remaining_actions`,
    [grantId, userId, actions],
  );
  if (!result.rows.length) {
    const existing = await sql.query(
      "SELECT user_id,actions FROM nina_starter.allowance_grant WHERE id=$1::uuid",
      [grantId],
    );
    if (!existing.rows.length)
      throw new ControlError(
        "Initialize hosted AI access with users enable-ai or users disable-ai before adding actions",
      );
    if (existing.rows[0]?.user_id !== userId || Number(existing.rows[0]?.actions) !== actions)
      throw new ControlError("Grant ID already belongs to a different top-up");
  }
}

export async function report(user, username) {
  return database(async (sql) => {
    const account = await sql.query("select * from nina_starter.access($1)", [user.id]);
    const usage = await sql.query(
      "select model_id,operation,outcome,count(*) as requests,sum(charged_micro_usd) as conservative_micro_usd from nina_starter.reservation where user_id=$1 group by model_id,operation,outcome",
      [user.id],
    );
    const reported = await sql.query(
      "select id, admitted_at, duration_ms, usage from nina_starter.reservation where user_id=$1 order by admitted_at desc limit 100",
      [user.id],
    );
    const actual = await sql.query(
      `SELECT sum((attempt->>'costUsd')::numeric) AS reported_cost_usd,
        count(*) FILTER (WHERE attempt->>'costUsd' IS NOT NULL) AS attempts_with_reported_cost
        FROM nina_starter.reservation r CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.usage->'attempts','[]'::jsonb)) attempt WHERE user_id=$1`,
      [user.id],
    );
    const unknown = await sql.query(
      "SELECT count(*) AS requests_with_unknown_usage FROM nina_starter.reservation WHERE user_id=$1 AND (usage IS NULL OR usage->>'complete' IS DISTINCT FROM 'true')",
      [user.id],
    );
    output({
      username,
      account: account.rows,
      conservativeAccounting: usage.rows,
      reportedActualCost: actual.rows,
      unknownUsage: unknown.rows,
      recentReportedUsage: reported.rows,
    });
  });
}
